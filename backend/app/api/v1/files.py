"""File upload / download endpoints (§6.1, §6.3)."""

from __future__ import annotations

import urllib.parse
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from fastapi.responses import Response, StreamingResponse

from ...core.envelope import envelope
from ...core.errors import AppError
from ...schemas.common import Envelope, ErrorEnvelope
from ...schemas.files import UploadResult
from ...services import files as files_service
from ...services.storage import CHUNK_READ_SIZE
from ..deps import SessionDep, SettingsDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "参数校验失败 / 文件名非法 / Range 非法"},
    401: {"model": ErrorEnvelope, "description": "未认证"},
    404: {"model": ErrorEnvelope, "description": "文件不存在"},
    413: {"model": ErrorEnvelope, "description": "文件超过 50 MB"},
    415: {"model": ErrorEnvelope, "description": "文件类型不支持"},
}

router = APIRouter(tags=["files"], dependencies=[Depends(require_token)])


def _iter_upload(upload: UploadFile) -> Iterator[bytes]:
    """Yield the uploaded bytes in chunks so the size cap is enforced while reading."""
    while True:
        chunk = upload.file.read(CHUNK_READ_SIZE)
        if not chunk:
            return
        yield chunk


@router.post(
    "/files",
    response_model=Envelope[UploadResult],
    status_code=201,
    responses=_ERROR_RESPONSES,
    summary="小文件上传（≤50 MB）",
)
def upload_file(
    session: SessionDep,
    settings: SettingsDep,
    file: Annotated[UploadFile, File()],
    title: Annotated[str | None, Form()] = None,
    tags: Annotated[str | None, Form()] = None,
) -> dict[str, Any]:
    """Store a small file and create the matching file item."""
    result = files_service.create_file_item(
        session,
        settings,
        filename=file.filename or "",
        mime_type=file.content_type,
        chunks=_iter_upload(file),
        title=title,
        tags=files_service.parse_tags(tags),
    )
    return envelope(result)


def _content_disposition(filename: str) -> str:
    quoted = urllib.parse.quote(filename, safe="")
    ascii_fallback = filename.encode("ascii", "replace").decode("ascii").replace('"', "_")
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quoted}"


STREAM_BLOCK_SIZE = 64 * 1024


def _iter_file(path: Path, start: int, length: int) -> Iterator[bytes]:
    """Yield at most `length` bytes from `start` without loading the file at once."""
    remaining = length
    with path.open("rb") as handle:
        handle.seek(start)
        while remaining > 0:
            block = handle.read(min(STREAM_BLOCK_SIZE, remaining))
            if not block:
                return
            remaining -= len(block)
            yield block


@router.get(
    "/files/{asset_id}/download",
    response_class=Response,
    responses={
        200: {"content": {"application/octet-stream": {"schema": {"type": "string"}}}},
        206: {"description": "部分内容（Range）"},
        404: {"model": ErrorEnvelope},
        410: {"model": ErrorEnvelope},
    },
    summary="下载 / 预览文件（支持 Range）",
)
def download_file(
    session: SessionDep,
    settings: SettingsDep,
    asset_id: str,
    range_header: Annotated[str | None, Header(alias="Range")] = None,
) -> Response:
    """Stream a stored file, honouring a single Range request."""
    asset, _item = files_service.load_asset(session, asset_id)
    path = files_service.resolve_download_path(settings, asset)
    size = path.stat().st_size
    headers = {
        "Content-Disposition": _content_disposition(asset.original_name),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
    }
    media_type = asset.mime_type or "application/octet-stream"

    try:
        requested = files_service.parse_range(range_header, size)
    except AppError:
        # 416：请求范围超出文件长度
        headers["Content-Range"] = f"bytes */{size}"
        return Response(status_code=416, headers=headers, media_type=media_type)

    if requested is None:
        headers["Content-Length"] = str(size)
        return StreamingResponse(_iter_file(path, 0, size), media_type=media_type, headers=headers)

    headers["Content-Range"] = f"bytes {requested.start}-{requested.end}/{size}"
    headers["Content-Length"] = str(requested.length)
    return StreamingResponse(
        _iter_file(path, requested.start, requested.length),
        status_code=206,
        media_type=media_type,
        headers=headers,
    )
