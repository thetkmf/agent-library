"""Local file storage: validation, atomic writes and safe path resolution."""

from __future__ import annotations

import hashlib
import shutil
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from ..core.config import Settings
from ..core.errors import AppError, ErrorCode
from ..core.ids import new_id
from ..core.logging import get_logger
from ..core.paths import build_layout, resolve_safe_path, sanitize_filename
from ..db.base import utcnow

logger = get_logger("pkb.storage")

CHUNK_READ_SIZE = 1024 * 1024

# 扩展名 -> 允许的 MIME 主类型；声明明显不符时按 40003 拒绝
_EXTENSION_FAMILIES: dict[str, tuple[str, ...]] = {
    "md": ("text",),
    "tex": ("text",),
    "txt": ("text",),
    "pdf": ("application",),
    "docx": ("application",),
    "pptx": ("application",),
    "xlsx": ("application",),
    "zip": ("application", "multipart"),
    "png": ("image",),
    "jpg": ("image",),
    "jpeg": ("image",),
    "webp": ("image",),
    "svg": ("image", "text"),
    "mp3": ("audio",),
    "wav": ("audio",),
    "mp4": ("video",),
}


@dataclass(frozen=True, slots=True)
class StoredFile:
    """Result of storing an upload on disk."""

    relative_path: str
    absolute_path: Path
    size_bytes: int
    sha256: str
    original_name: str
    mime_type: str


def _extension_of(name: str) -> str:
    suffix = Path(name).suffix
    return suffix[1:].lower() if suffix.startswith(".") else suffix.lower()


def _family_of(mime_type: str) -> str:
    return mime_type.split("/", 1)[0].strip().lower() if mime_type else ""


class StorageService:
    """Writes uploads under the data directory and resolves them safely."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.layout = build_layout(settings)

    # ---- validation -------------------------------------------------
    def validate_filename(self, name: str) -> str:
        """Sanitise the client file name; blank results are rejected (40002)."""
        try:
            return sanitize_filename(name or "")
        except AppError as exc:
            raise AppError(ErrorCode.UNSUPPORTED_QUERY, "文件名清洗后为空") from exc

    def validate_extension(self, name: str, mime_type: str) -> str:
        """Check the extension whitelist and obvious MIME mismatches (40003)."""
        extension = _extension_of(name)
        allowed = self.settings.allowed_extensions
        if extension not in allowed:
            raise AppError(
                ErrorCode.UNSUPPORTED_FILE_TYPE,
                f"不支持的文件类型：{extension or '无扩展名'}",
                details={"allowed_extensions": list(allowed)},
            )
        declared = (mime_type or "").lower()
        if declared in ("", "application/octet-stream", "binary/octet-stream"):
            return extension
        families = _EXTENSION_FAMILIES.get(extension)
        if families is not None and _family_of(declared) not in families:
            logger.warning(
                "upload.mime_mismatch",
                extra={"fields": {"extension": extension, "mime_family": _family_of(declared)}},
            )
            raise AppError(
                ErrorCode.UNSUPPORTED_FILE_TYPE,
                "声明的内容类型与文件扩展名不符",
                details={"extension": extension, "mime_type": declared},
            )
        return extension

    # ---- write ------------------------------------------------------
    def _free_bytes(self) -> int:
        base = self.layout.files_dir if self.layout.files_dir.exists() else self.layout.data_dir
        return shutil.disk_usage(str(base)).free

    def _ensure_free(self, needed: int) -> None:
        """Raise 60002 before/while writing so a full disk never becomes 60001."""
        if self._free_bytes() < needed:
            raise AppError(ErrorCode.STORAGE_FULL, "磁盘空间不足，无法保存文件")

    def store_chunks(
        self,
        *,
        filename: str,
        mime_type: str,
        chunks: Iterable[bytes],
        max_bytes: int,
    ) -> StoredFile:
        """Stream chunks to a temp file, then move it into place atomically."""
        original_name = self.validate_filename(filename)
        self.validate_extension(original_name, mime_type)
        self.layout.files_dir.mkdir(parents=True, exist_ok=True)
        tmp_dir = self.layout.files_dir / ".tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)

        digest = hashlib.sha256()
        size = 0
        tmp_path: Path | None = None
        reserve = 1024 * 1024  # 至少留 1 MB 余量
        self._ensure_free(reserve)
        next_space_check = 64 * 1024 * 1024
        try:
            with tempfile.NamedTemporaryFile(dir=tmp_dir, suffix=".part", delete=False) as handle:
                tmp_path = Path(handle.name)
                for chunk in chunks:
                    if not chunk:
                        continue
                    size += len(chunk)
                    if size > max_bytes:
                        raise AppError(
                            ErrorCode.FILE_TOO_LARGE,
                            f"文件超过 {max_bytes // (1024 * 1024)} MB，请改用分片上传",
                            details={"max_bytes": max_bytes},
                        )
                    digest.update(chunk)
                    try:
                        handle.write(chunk)
                    except OSError as write_error:
                        raise AppError(
                            ErrorCode.STORAGE_FULL, "磁盘空间不足，无法保存文件"
                        ) from write_error
                    if size >= next_space_check:
                        self._ensure_free(reserve)
                        next_space_check += 64 * 1024 * 1024
            now = utcnow()
            relative_dir = f"{now.year:04d}/{now.month:02d}/{new_id()}"
            target_dir = resolve_safe_path(self.layout.files_dir, relative_dir)
            target_dir.mkdir(parents=True, exist_ok=True)
            target = resolve_safe_path(self.layout.files_dir, f"{relative_dir}/{original_name}")
            tmp_path.replace(target)
            return StoredFile(
                relative_path=f"{relative_dir}/{original_name}",
                absolute_path=target,
                size_bytes=size,
                sha256=digest.hexdigest(),
                original_name=original_name,
                mime_type=mime_type or "application/octet-stream",
            )
        except OSError as exc:
            logger.error("storage.write_failed", extra={"fields": {"reason": type(exc).__name__}})
            raise AppError(ErrorCode.STORAGE_WRITE_FAILED, "文件写入失败") from exc
        finally:
            if tmp_path is not None and tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    logger.warning("storage.tmp_cleanup_failed")

    # ---- read / cleanup ---------------------------------------------
    def absolute_path(self, relative_path: str) -> Path:
        """Resolve a stored relative path, refusing traversal (60003)."""
        return resolve_safe_path(self.layout.files_dir, relative_path)

    def delete(self, relative_path: str) -> None:
        """Best-effort removal of a stored file (rollback path)."""
        try:
            path = self.absolute_path(relative_path)
        except AppError:
            return
        try:
            if path.exists():
                path.unlink()
            parent = path.parent
            while parent != self.layout.files_dir and parent.exists() and not any(parent.iterdir()):
                parent.rmdir()
                parent = parent.parent
        except OSError:
            logger.warning("storage.delete_failed")
