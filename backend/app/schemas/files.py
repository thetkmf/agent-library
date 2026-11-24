"""Upload payloads for POST /files, /uploads and complete (§6.1–6.2)."""

from __future__ import annotations

from pydantic import BaseModel, field_validator

from .items import FileAssetOut, ItemOut


class UploadResult(BaseModel):
    """Result of a completed upload: file item plus its asset."""

    item: ItemOut
    file_asset: FileAssetOut


class UploadInitRequest(BaseModel):
    """Body of POST /uploads (§6.2)."""

    original_name: str
    size_bytes: int
    mime_type: str | None = None
    sha256: str
    title: str | None = None
    tags: list[str] | None = None

    @field_validator("tags", mode="before")
    @classmethod
    def _split_tags(cls, value: object) -> object:
        """Accept a comma separated string as well as a JSON array."""
        if isinstance(value, str):
            return [part for part in (item.strip() for item in value.split(",")) if part]
        return value


class UploadInitOut(BaseModel):
    """Upload session descriptor returned by POST /uploads."""

    upload_id: str
    chunk_size: int
    chunk_count: int


class ChunkResult(BaseModel):
    """Result of one chunk PUT."""

    index: int
    sha256: str
