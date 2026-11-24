"""Upload payloads shared by POST /files and /uploads/{id}/complete (§6.1–6.2)."""

from __future__ import annotations

from pydantic import BaseModel

from .items import FileAssetOut, ItemOut


class UploadResult(BaseModel):
    """Atomic result of a completed upload: the file item plus its asset."""

    item: ItemOut
    file_asset: FileAssetOut
