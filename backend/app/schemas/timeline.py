"""Timeline payloads for ``GET /timeline`` (§9.2)."""

from __future__ import annotations

from pydantic import BaseModel, Field

from .items import ItemOut


class TimelineGroup(BaseModel):
    """One day / week / month bucket containing the items from the current page."""

    key: str
    label: str
    item_count: int
    items: list[ItemOut] = Field(default_factory=list)


class TimelineOut(BaseModel):
    """Grouped timeline page; ``groups`` only covers the items in this page."""

    groups: list[TimelineGroup] = Field(default_factory=list)
    next_cursor: str | None = None
    has_more: bool = False
