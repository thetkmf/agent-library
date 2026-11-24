"""Tag reference shared by items and timeline payloads."""

from __future__ import annotations

from pydantic import BaseModel


class TagRef(BaseModel):
    """Minimal tag projection embedded in items."""

    id: str
    name: str
