"""Item payloads for the /items endpoints (contract §8.1, §9.2)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .tags import TagRef

ItemType = Literal["note", "tex", "file"]
ItemStatus = Literal["active", "archived", "trashed"]
EmbeddingStatus = Literal["pending", "indexed", "failed", "skipped"]


class FileAssetOut(BaseModel):
    """File metadata; the absolute disk path is never exposed."""

    id: str
    original_name: str
    mime_type: str
    size_bytes: int
    sha256: str
    download_url: str
    created_at: datetime


class ItemCreate(BaseModel):
    """Create payload for note / tex / file items."""

    type: ItemType
    title: str = Field(min_length=1, max_length=200)
    content: str | None = None
    tags: list[str] = Field(default_factory=list)
    file_asset_id: str | None = None


class ItemUpdate(BaseModel):
    """Partial update; the body carries the version used for optimistic locking."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    tags: list[str] | None = None
    status: ItemStatus | None = None
    expected_version: int | None = Field(default=None, ge=1)


class ItemOut(BaseModel):
    """Item projection returned by the API."""

    id: str
    type: ItemType
    title: str
    content: str | None = None
    preview: str
    tags: list[TagRef] = Field(default_factory=list)
    file: FileAssetOut | None = None
    status: ItemStatus
    version: int
    embedding_status: EmbeddingStatus
    ai_summary: str | None = None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
    idempotent_replay: bool = False
