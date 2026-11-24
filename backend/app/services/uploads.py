"""Chunked upload sessions (§6.2): session state, chunks and completion."""

from __future__ import annotations

import hashlib
import json
import math
import mimetypes
import shutil
import threading
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ..core.config import DEFAULT_CHUNK_SIZE_BYTES, Settings
from ..core.errors import AppError, ErrorCode, not_found
from ..core.ids import new_id
from ..core.logging import get_logger
from ..core.paths import build_layout, resolve_safe_path
from ..db.base import utcnow
from ..schemas.files import ChunkResult, UploadInitOut, UploadInitRequest, UploadResult
from .files import create_file_item, file_asset_out, load_asset
from .items import to_item_out
from .storage import StorageService

logger = get_logger("pkb.uploads")

SESSION_FILE = "session.json"
CHUNKS_DIR = "chunks"
CHUNK_SUFFIX = ".part"
SESSION_TTL = timedelta(hours=24)
MIN_CHUNK_BYTES = 5 * 1024 * 1024
MAX_CHUNK_BYTES = 20 * 1024 * 1024
SHA256_LENGTH = 64
_HEX_DIGITS = frozenset("0123456789abcdef")

_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


@dataclass(slots=True)
class UploadSession:
    """Persisted state of one chunked upload."""

    upload_id: str
    original_name: str
    size_bytes: int
    mime_type: str
    sha256: str
    chunk_size: int
    chunk_count: int
    title: str | None
    tags: list[str]
    created_at: str
    completed_item_id: str | None = None
    completed_asset_id: str | None = None


def effective_chunk_size(settings: Settings) -> int:
    """Use the configured chunk size when it sits in the 5-20 MB window."""
    size = settings.chunk_size_bytes
    if MIN_CHUNK_BYTES <= size <= MAX_CHUNK_BYTES:
        return size
    return DEFAULT_CHUNK_SIZE_BYTES


def _root(settings: Settings) -> Path:
    return build_layout(settings).uploads_dir


def _expired() -> AppError:
    return not_found("上传会话不存在或已过期")


def _session_dir(settings: Settings, upload_id: str) -> Path:
    try:
        return resolve_safe_path(_root(settings), upload_id)
    except AppError as exc:
        raise _expired() from exc


def _lock_for(upload_id: str) -> threading.Lock:
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(upload_id, threading.Lock())


def _parse_time(raw: str) -> datetime | None:
    try:
        value = datetime.fromisoformat(raw)
    except ValueError:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _save(settings: Settings, state: UploadSession) -> None:
    directory = _session_dir(settings, state.upload_id)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / SESSION_FILE
    tmp = target.with_suffix(".tmp")
    tmp.write_text(json.dumps(asdict(state), ensure_ascii=False), encoding="utf-8")
    tmp.replace(target)


def _discard(settings: Settings, upload_id: str) -> None:
    shutil.rmtree(_session_dir(settings, upload_id), ignore_errors=True)


def _load(settings: Settings, upload_id: str) -> UploadSession:
    directory = _session_dir(settings, upload_id)
    try:
        payload: dict[str, Any] = json.loads((directory / SESSION_FILE).read_text("utf-8"))
        state = UploadSession(**payload)
    except (OSError, ValueError, TypeError) as exc:
        raise _expired() from exc
    created = _parse_time(state.created_at)
    if created is None or utcnow() - created > SESSION_TTL:
        _discard(settings, upload_id)
        raise _expired()
    return state


def _validate_sha256(value: str, field: str) -> str:
    digest = (value or "").strip().lower()
    if len(digest) != SHA256_LENGTH or any(ch not in _HEX_DIGITS for ch in digest):
        raise AppError(ErrorCode.UNSUPPORTED_QUERY, f"{field} 必须是 64 位十六进制 sha256")
    return digest


def _expected_chunk_size(state: UploadSession, index: int) -> int:
    if index == state.chunk_count - 1:
        return state.size_bytes - state.chunk_size * (state.chunk_count - 1)
    return state.chunk_size


def init_session(settings: Settings, payload: UploadInitRequest) -> UploadInitOut:
    """Create a 24h upload session and return its chunk plan."""
    storage = StorageService(settings)
    name = storage.validate_filename(payload.original_name)
    storage.validate_extension(name, payload.mime_type or "")
    if payload.size_bytes <= 0:
        raise AppError(ErrorCode.UNSUPPORTED_QUERY, "文件大小必须大于 0")
    if payload.size_bytes > settings.max_file_bytes:
        raise AppError(
            ErrorCode.FILE_TOO_LARGE,
            "文件大小超出上限",
            details={"max_bytes": settings.max_file_bytes},
        )
    expected_sha = _validate_sha256(payload.sha256, "sha256")

    chunk_size = max(1, min(effective_chunk_size(settings), payload.size_bytes))
    chunk_count = math.ceil(payload.size_bytes / chunk_size)
    upload_id = new_id()
    state = UploadSession(
        upload_id=upload_id,
        original_name=name,
        size_bytes=payload.size_bytes,
        mime_type=payload.mime_type or mimetypes.guess_type(name)[0] or "application/octet-stream",
        sha256=expected_sha,
        chunk_size=chunk_size,
        chunk_count=chunk_count,
        title=(payload.title or "").strip() or None,
        tags=[tag.strip() for tag in (payload.tags or []) if tag.strip()],
        created_at=utcnow().isoformat(),
    )
    _save(settings, state)
    (_session_dir(settings, upload_id) / CHUNKS_DIR).mkdir(parents=True, exist_ok=True)
    logger.info("upload.session_created", extra={"fields": {"chunk_count": chunk_count}})
    return UploadInitOut(upload_id=upload_id, chunk_size=chunk_size, chunk_count=chunk_count)


def put_chunk(settings: Settings, upload_id: str, index: int, data: bytes) -> ChunkResult:
    """Store one chunk idempotently; re-sending an index overwrites it."""
    state = _load(settings, upload_id)
    if index < 0 or index >= state.chunk_count:
        raise AppError(
            ErrorCode.UPLOAD_INCOMPLETE,
            "分片序号越界",
            details={"chunk_count": state.chunk_count},
        )
    expected = _expected_chunk_size(state, index)
    if len(data) != expected:
        raise AppError(
            ErrorCode.UPLOAD_INCOMPLETE,
            "分片大小与约定不符",
            details={"index": index, "expected": expected, "received": len(data)},
        )
    digest = hashlib.sha256(data).hexdigest()
    chunks_dir = _session_dir(settings, upload_id) / CHUNKS_DIR
    chunks_dir.mkdir(parents=True, exist_ok=True)
    target = chunks_dir / f"{index:06d}{CHUNK_SUFFIX}"
    with _lock_for(upload_id):
        tmp = target.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(target)
    return ChunkResult(index=index, sha256=digest)


def _iter_chunks(chunks_dir: Path, state: UploadSession) -> Iterator[bytes]:
    """Yield stored chunks in order, raising 40005 when one is missing."""
    for index in range(state.chunk_count):
        path = chunks_dir / f"{index:06d}{CHUNK_SUFFIX}"
        if not path.is_file():
            raise AppError(
                ErrorCode.UPLOAD_INCOMPLETE,
                "分片不完整，请重传缺失分片",
                details={"missing_index": index},
            )
        yield path.read_bytes()


def _compute_sha256(state: UploadSession, chunks_dir: Path) -> str:
    digest = hashlib.sha256()
    total = 0
    for block in _iter_chunks(chunks_dir, state):
        total += len(block)
        digest.update(block)
    if total != state.size_bytes:
        raise AppError(
            ErrorCode.UPLOAD_INCOMPLETE,
            "分片总大小与声明不一致",
            details={"expected": state.size_bytes, "received": total},
        )
    return digest.hexdigest()


def complete_session(
    session: Session, settings: Settings, upload_id: str
) -> tuple[UploadResult, bool]:
    """Assemble the chunks into a file item; repeated calls replay the first result."""
    state = _load(settings, upload_id)
    if state.completed_item_id and state.completed_asset_id:
        asset, item = load_asset(session, state.completed_asset_id)
        return (
            UploadResult(item=to_item_out(item), file_asset=file_asset_out(asset)),
            True,
        )

    chunks_dir = _session_dir(settings, upload_id) / CHUNKS_DIR
    actual_sha = _compute_sha256(state, chunks_dir)
    if actual_sha != state.sha256:
        raise AppError(
            ErrorCode.UPLOAD_INCOMPLETE,
            "整体 sha256 校验失败，请重新上传",
            details={"expected": state.sha256, "actual": actual_sha},
        )

    with _lock_for(upload_id):
        state = _load(settings, upload_id)
        if state.completed_item_id and state.completed_asset_id:
            asset, item = load_asset(session, state.completed_asset_id)
            return (
                UploadResult(item=to_item_out(item), file_asset=file_asset_out(asset)),
                True,
            )
        result = create_file_item(
            session,
            settings,
            filename=state.original_name,
            mime_type=state.mime_type,
            chunks=_iter_chunks(chunks_dir, state),
            title=state.title,
            tags=state.tags,
            max_bytes=state.size_bytes,
            expected_sha256=state.sha256,
        )
        state.completed_item_id = result.item.id
        state.completed_asset_id = result.file_asset.id
        _save(settings, state)
        shutil.rmtree(chunks_dir, ignore_errors=True)
        logger.info(
            "upload.session_completed", extra={"fields": {"chunk_count": state.chunk_count}}
        )
        return result, False


def cleanup_expired(settings: Settings) -> int:
    """Remove upload sessions older than the TTL (startup housekeeping)."""
    root = _root(settings)
    if not root.is_dir():
        return 0
    removed = 0
    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        state_file = entry / SESSION_FILE
        try:
            payload = json.loads(state_file.read_text("utf-8"))
            created = _parse_time(str(payload.get("created_at", "")))
        except (OSError, ValueError, TypeError):
            created = None
        if created is None or utcnow() - created > SESSION_TTL:
            shutil.rmtree(entry, ignore_errors=True)
            removed += 1
    return removed


def collect_chunks(data: Iterable[bytes]) -> bytes:
    """Join streamed request chunks (helper for the router)."""
    return b"".join(data)
