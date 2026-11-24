"""Search payloads (§9.5, B6)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SearchItemRef(BaseModel):
    """Minimal item projection embedded in search hits."""

    id: str
    type: Literal["note", "tex", "file"]
    title: str


class SearchHitOut(BaseModel):
    """One search result."""

    item: SearchItemRef
    score: float = Field(ge=0.0, le=1.0)
    snippet: str
    match_type: Literal["keyword", "semantic"]


class SearchResponse(BaseModel):
    """Body of GET /search."""

    items: list[SearchHitOut] = Field(default_factory=list)
    total: int = 0
    mode: Literal["keyword", "semantic", "hybrid"]
    degraded: bool = False
