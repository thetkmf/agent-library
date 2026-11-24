"""File upload / download orchestration (§6.1, §6.3)."""

from __future__ import annotations

import mimetypes
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from ..core.config import Settings
from ..core.errors import AppError, ErrorCode, not_found, validation_failed
from ..db.models import FileAsset, Item
from ..repositories import items as items_repo
from ..schemas.files import UploadResult
from ..schemas.items import FileAssetOut, ItemOut
from .items import to_item_out
from .storage import StorageService
from .text_extraction import is_extractable_filename

TITLE_MAX_LENGTH = 200
_RANGE_PATTERN = re.compile(r"^bytes=(\d*)-(\d*)$")


@dataclass(frozen=True, slots=True)
class DownloadRange:
    """Resolved byte range of a download request."""

    start: int
    end: int

    @property
    def length(self) -> int:
        return self.end - self.start + 1


def file_asset_out(asset: FileAsset) -> FileAssetOut:
    return FileAssetOut(
        id=asset.id,
        original_name=asset.original_name,
        mime_type=asset.mime_type,
        size_bytes=asset.size_bytes,
        sha256=asset.sha256,
        download_url=f"/files/{asset.id}/download",
        created_at=asset.created_at,
    )


def parse_tags(raw: str | None) -> list[str]:
    """Split the comma separated multipart field into tag names."""
    if not raw:
        return []
    return [part for part in (chunk.strip() for chunk in raw.split(",")) if part]


def create_file_item(
    session: Session,
    settings: Settings,
    *,
    filename: str,
    mime_type: str | None,
    chunks: Iterable[bytes],
    title: str | None = None,
    tags: list[str] | None = None,
    max_bytes: int | None = None,
    expected_sha256: str | None = None,
) -> UploadResult:
    """Store the bytes then create item + file asset in one transaction."""
    storage = StorageService(settings)
    declared_mime = mime_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    stored = storage.store_chunks(
        filename=filename,
        mime_type=declared_mime,
        chunks=chunks,
        max_bytes=max_bytes if max_bytes is not None else settings.max_small_file_bytes,
    )
    if expected_sha256 is not None and stored.sha256 != expected_sha256:
        storage.delete(stored.relative_path)
        raise AppError(
            ErrorCode.UPLOAD_INCOMPLETE,
            "整体 sha256 校验失败，请重新上传",
            details={"expected": expected_sha256, "actual": stored.sha256},
        )

    resolved_title = (title or "").strip() or stored.original_name
    if len(resolved_title) > TITLE_MAX_LENGTH:
        resolved_title = resolved_title[:TITLE_MAX_LENGTH]
    if not resolved_title:
        storage.delete(stored.relative_path)
        raise validation_failed("标题不能为空")

    try:
        item = Item(
            type="file",
            title=resolved_title,
            content=None,
            preview="",
            status="active",
            version=1,
            embedding_status=(
                "pending" if is_extractable_filename(stored.original_name) else "skipped"
            ),
        )
        asset = FileAsset(
            item=item,
            original_name=stored.original_name,
            mime_type=stored.mime_type,
            size_bytes=stored.size_bytes,
            sha256=stored.sha256,
            relative_path=stored.relative_path,
        )
        session.add(item)
        session.add(asset)
        session.flush()

        tag_rows = items_repo.ensure_tags(session, tags or [])
        if tag_rows:
            items_repo.replace_tags(session, item, tag_rows)
        session.commit()
        session.expire_all()

        reloaded = items_repo.get_item(session, item.id)
        if reloaded is None:  # pragma: no cover - 仅在并发删除时出现
            raise AppError(ErrorCode.STORAGE_WRITE_FAILED, "文件条目创建失败")
        assert reloaded.file_asset is not None
        return UploadResult(
            item=to_item_out(reloaded),
            file_asset=file_asset_out(reloaded.file_asset),
        )
    except Exception:
        session.rollback()
        storage.delete(stored.relative_path)
        raise


def load_asset(session: Session, asset_id: str) -> tuple[FileAsset, Item]:
    """Load an asset for download; recycled items are treated as missing."""
    asset = session.get(FileAsset, asset_id)
    if asset is None:
        raise not_found("文件不存在")
    item = session.get(Item, asset.item_id)
    if item is None or item.deleted_at is not None:
        raise not_found("文件不存在")
    return asset, item


def resolve_download_path(settings: Settings, asset: FileAsset) -> Path:
    """Return the on-disk path, mapping a missing file to 410 + 30001."""
    path = StorageService(settings).absolute_path(asset.relative_path)
    if not path.is_file():
        raise AppError(ErrorCode.NOT_FOUND, "文件已不可用", http_status=410)
    return path


def parse_range(header: str | None, size: int) -> DownloadRange | None:
    """Parse a single ``bytes=`` Range header; returns None when absent/ignored."""
    if not header:
        return None
    match = _RANGE_PATTERN.match(header.strip())
    if match is None:
        return None
    start_raw, end_raw = match.groups()
    if start_raw == "" and end_raw == "":
        return None
    if start_raw == "":
        suffix = int(end_raw)
        if suffix <= 0:
            return None
        start = max(size - suffix, 0)
        end = size - 1
    else:
        start = int(start_raw)
        end = int(end_raw) if end_raw else size - 1
    if start >= size:
        raise AppError(ErrorCode.UNSUPPORTED_QUERY, "Range 超出文件长度", http_status=416)
    end = min(end, size - 1)
    if end < start:
        return None
    return DownloadRange(start=start, end=end)


def item_out_by_id(session: Session, item_id: str) -> ItemOut:
    """Re-read an item for response payloads."""
    item = items_repo.get_item(session, item_id)
    if item is None:
        raise not_found("条目不存在")
    return to_item_out(item)
