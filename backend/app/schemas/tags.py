"""Tag payloads for the /tags and /items/{id}/tags endpoints (§8.2, §9.3)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from ..core.tags import TAG_NAME_MAX_LENGTH, normalize_tag_name


class TagRef(BaseModel):
    """Minimal tag projection embedded in items."""

    id: str
    name: str


class TagCreate(BaseModel):
    """Create payload for a tag; the name is trimmed before length validation."""

    name: str = Field(min_length=1, max_length=TAG_NAME_MAX_LENGTH)

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value: object) -> object:
        if isinstance(value, str):
            return normalize_tag_name(value)
        return value


class TagUpdate(BaseModel):
    """Rename payload for a tag."""

    name: str = Field(min_length=1, max_length=TAG_NAME_MAX_LENGTH)

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value: object) -> object:
        if isinstance(value, str):
            return normalize_tag_name(value)
        return value


class TagOut(BaseModel):
    """Tag projection returned by ``GET /tags``."""

    id: str
    name: str
    item_count: int
    created_at: datetime


class AttachTagsRequest(BaseModel):
    """Bulk tag association payload; duplicates and existing links are ignored."""

    tag_ids: list[str] = Field(default_factory=list)
