"""Item business logic: validation, versions, recycle bin and content I/O."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any, Final

from sqlalchemy.orm import Session

from ..core.errors import (
    already_exists,
    not_found,
    unsupported_query,
    validation_failed,
    version_conflict,
)
from ..db.base import utcnow
from ..db.models import FileAsset, Item
from ..repositories import idempotency as idempotency_repo
from ..repositories import items as repo
from ..schemas.items import FileAssetOut, ItemCreate, ItemOut, ItemUpdate
from ..schemas.tags import TagRef

PREVIEW_LENGTH: Final[int] = 200
IDEMPOTENCY_TTL: Final[timedelta] = timedelta(hours=24)
IDEMPOTENCY_SCOPE: Final[str] = "items.create"
_MARKUP_PATTERN = re.compile(r"[#>*_`~\[\]()!|-]+")
_WHITESPACE_PATTERN = re.compile(r"\s+")

_ITEM_TYPE_LABEL = {"note": "笔记", "tex": "TeX 便签", "file": "文件"}


def build_preview(content: str, *, length: int = PREVIEW_LENGTH) -> str:
    """Return a plain-text teaser of the content."""
    text = _MARKUP_PATTERN.sub(" ", content)
    text = _WHITESPACE_PATTERN.sub(" ", text).strip()
    return text[:length]


def _file_out(asset: FileAsset) -> FileAssetOut:
    return FileAssetOut(
        id=asset.id,
        original_name=asset.original_name,
        mime_type=asset.mime_type,
        size_bytes=asset.size_bytes,
        sha256=asset.sha256,
        download_url=f"/files/{asset.id}/download",
        created_at=asset.created_at,
    )


def to_item_out(item: Item, *, idempotent_replay: bool = False) -> ItemOut:
    """Project an ORM item into the API payload."""
    return ItemOut(
        id=item.id,
        type=item.type,
        title=item.title,
        content=item.content,
        preview=item.preview,
        tags=[TagRef(id=tag.id, name=tag.name) for tag in item.tags],
        file=_file_out(item.file_asset) if item.file_asset is not None else None,
        status=item.status,
        version=item.version,
        embedding_status=item.embedding_status,
        ai_summary=item.ai_summary,
        created_at=item.created_at,
        updated_at=item.updated_at,
        deleted_at=item.deleted_at,
        idempotent_replay=idempotent_replay,
    )


def _payload_hash(payload: ItemCreate) -> str:
    raw = json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _load_or_404(session: Session, item_id: str) -> Item:
    item = repo.get_item(session, item_id)
    if item is None:
        raise not_found("条目不存在")
    return item


def _load_active(session: Session, item_id: str) -> Item:
    item = _load_or_404(session, item_id)
    if item.deleted_at is not None:
        raise not_found("条目在回收站中")
    return item


def _validate_create_payload(session: Session, payload: ItemCreate) -> FileAsset | None:
    if payload.type == "file":
        if payload.content:
            raise validation_failed("文件条目的正文必须为空")
        if not payload.file_asset_id:
            raise validation_failed("文件条目必须提供 file_asset_id")
        asset = session.get(FileAsset, payload.file_asset_id)
        if asset is None:
            raise not_found("附件不存在，无法创建文件条目")
        if asset.item_id is not None:
            raise validation_failed("该附件已被其他条目占用")
        return asset
    if payload.content is None:
        raise validation_failed(f"{_ITEM_TYPE_LABEL[payload.type]}的正文不能为空")
    if payload.file_asset_id:
        raise validation_failed("非文件条目不能指定 file_asset_id")
    return None


def create_item(
    session: Session,
    payload: ItemCreate,
    *,
    idempotency_key: str | None = None,
) -> ItemOut:
    """Create an item; replays the first result for a repeated Idempotency-Key."""
    request_hash = _payload_hash(payload)
    if idempotency_key:
        stored = idempotency_repo.get_entry(session, idempotency_key, IDEMPOTENCY_SCOPE)
        if stored is not None and utcnow() - stored.created_at <= IDEMPOTENCY_TTL:
            if stored.request_hash != request_hash:
                raise already_exists("相同 Idempotency-Key 的请求内容不一致")
            replay = dict(stored.response_data)
            replay["idempotent_replay"] = True
            return ItemOut.model_validate(replay)

    asset = _validate_create_payload(session, payload)
    item = Item(
        type=payload.type,
        title=payload.title.strip(),
        content=payload.content,
        preview=build_preview(payload.content or ""),
        status="active",
        version=1,
        embedding_status="pending" if payload.type != "file" else "skipped",
    )
    if not item.title:
        raise validation_failed("标题不能为空")
    if asset is not None:
        item.file_asset = asset
    result = to_item_out(repo.add_item(session, item))

    tags = repo.ensure_tags(session, payload.tags)
    if tags:
        repo.replace_tags(session, item, tags)
        session.expire_all()
        result = to_item_out(_load_or_404(session, item.id))

    if idempotency_key:
        idempotency_repo.save_entry(
            session,
            key=idempotency_key,
            scope=IDEMPOTENCY_SCOPE,
            request_hash=request_hash,
            response_data=result.model_dump(mode="json"),
        )
    session.commit()
    return result


def list_items(
    session: Session,
    *,
    types: list[str] | None = None,
    tag_ids: list[str] | None = None,
    status: str | None = None,
    q: str | None = None,
    created_from: str | None = None,
    created_to: str | None = None,
    sort: str = "created_at",
    order: str = "desc",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[ItemOut], int, bool]:
    """Return one page of items and the paging metadata."""
    if page < 1:
        raise unsupported_query("page 必须大于等于 1")
    if not 1 <= page_size <= 100:
        raise unsupported_query("page_size 必须在 1 到 100 之间")
    if sort not in repo.SORTABLE_COLUMNS:
        raise unsupported_query(f"不支持的排序字段：{sort}")
    if order not in ("asc", "desc"):
        raise unsupported_query("order 只支持 asc 或 desc")
    valid_types = {"note", "tex", "file"}
    if types and not set(types) <= valid_types:
        raise unsupported_query("type 只支持 note、tex、file")
    if status is not None and status not in {"active", "archived", "trashed"}:
        raise unsupported_query("status 只支持 active、archived、trashed")
    filters = repo.ItemFilters(
        types=tuple(types or ()),
        tag_ids=tuple(tag_ids or ()),
        status=status,
        q=q,
        created_from=_parse_timestamp(created_from, "created_from"),
        created_to=_parse_timestamp(created_to, "created_to"),
    )
    rows, total = repo.list_items(
        session,
        filters,
        sort=sort,
        descending=order == "desc",
        page=page,
        page_size=page_size,
    )
    items = [to_item_out(row) for row in rows]
    return items, total, page * page_size < total


def _parse_timestamp(value: str | None, field: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise unsupported_query(f"{field} 不是合法的 ISO 8601 时间") from exc
    return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def get_item(session: Session, item_id: str) -> ItemOut:
    """Return one item, including items sitting in the recycle bin."""
    return to_item_out(_load_or_404(session, item_id))


def _resolve_expected_version(body_version: int | None, header_version: str | None) -> int:
    if body_version is not None:
        return body_version
    if header_version:
        try:
            return int(header_version.strip())
        except ValueError as exc:
            raise validation_failed("If-Match 必须是整数版本号") from exc
    raise validation_failed("更新请求必须带 expected_version")


def update_item(
    session: Session,
    item_id: str,
    payload: ItemUpdate,
    *,
    if_match: str | None = None,
) -> ItemOut:
    """Patch title / tags / status with optimistic locking."""
    item = _load_active(session, item_id)
    expected = _resolve_expected_version(payload.expected_version, if_match)
    if item.version != expected:
        raise version_conflict(data=to_item_out(item).model_dump(mode="json"))

    values: dict[str, Any] = {}
    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise validation_failed("标题不能为空")
        values["title"] = title
    if payload.status is not None:
        values["status"] = payload.status
        if payload.status == "trashed" and item.deleted_at is None:
            values["deleted_at"] = utcnow()
        elif payload.status in ("active", "archived") and item.deleted_at is not None:
            values["deleted_at"] = None

    # Any structural change (title / status / tags) bumps the version atomically.
    # Tag-only PATCH used to skip this, letting a stale body save slip through.
    if values or payload.tags is not None:
        updated = repo.update_item(session, item_id, values, expected_version=expected)
        if updated is None:
            session.rollback()
            current = repo.get_item(session, item_id)
            raise version_conflict(
                data=to_item_out(current).model_dump(mode="json") if current else None
            )
    else:
        updated = item

    if payload.tags is not None:
        tags = repo.ensure_tags(session, payload.tags)
        repo.replace_tags(session, updated, tags)
        session.expire_all()
        updated = _load_or_404(session, item_id)

    session.commit()
    return to_item_out(updated)


def delete_item(session: Session, item_id: str) -> ItemOut:
    """Soft delete: move the item into the recycle bin."""
    item = _load_or_404(session, item_id)
    if item.deleted_at is None:
        repo.mark_deleted(session, item)
    session.commit()
    session.refresh(item)
    return to_item_out(item)


def restore_item(session: Session, item_id: str) -> ItemOut:
    """Restore an item from the recycle bin."""
    item = _load_or_404(session, item_id)
    if item.deleted_at is None:
        raise validation_failed("条目不在回收站中，无需恢复")
    repo.mark_restored(session, item)
    session.commit()
    session.refresh(item)
    return to_item_out(item)


def get_content(session: Session, item_id: str) -> str:
    """Return the raw content used by the editor."""
    item = _load_active(session, item_id)
    if item.type == "file":
        raise validation_failed("文件条目没有可编辑正文")
    return item.content or ""


def put_content(
    session: Session,
    item_id: str,
    content: str,
    *,
    expected_version: int | None,
    if_match: str | None = None,
) -> ItemOut:
    """Save raw content with optimistic locking."""
    item = _load_active(session, item_id)
    if item.type == "file":
        raise validation_failed("文件条目没有可编辑正文")
    expected = _resolve_expected_version(expected_version, if_match)
    if item.version != expected:
        raise version_conflict(data=to_item_out(item).model_dump(mode="json"))

    updated = repo.update_item(
        session,
        item_id,
        {"content": content, "preview": build_preview(content), "embedding_status": "pending"},
        expected_version=expected,
    )
    if updated is None:
        session.rollback()
        current = repo.get_item(session, item_id)
        raise version_conflict(
            data=to_item_out(current).model_dump(mode="json") if current else None
        )
    session.commit()
    return to_item_out(updated)
