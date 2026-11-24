"""Index endpoints payloads (§9.5, B5)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ReindexRequest(BaseModel):
    """Body of POST /index/reindex."""

    mode: Literal["incremental", "full"] = "incremental"


class ReindexAccepted(BaseModel):
    """202 payload returned when a reindex task is queued."""

    task_id: str
    type: str = "reindex"
    status: str = "queued"
    progress: int = 0


class IndexTaskState(BaseModel):
    """Current or last reindex task."""

    id: str
    status: str
    progress: int


class EmbeddingInfo(BaseModel):
    model: str
    dimension: int
    status: Literal["ready", "missing", "loading", "error"]


class IndexStatusOut(BaseModel):
    """Body of GET /index/status."""

    ready: bool
    indexed_count: int
    pending_count: int
    last_updated_at: datetime | None = None
    embedding: EmbeddingInfo
    task: IndexTaskState | None = None


class SearchHitItem(BaseModel):
    """Item projection used by search results (B6 consumes this shape)."""

    id: str
    type: str
    title: str


class SearchHit(BaseModel):
    item: SearchHitItem
    score: float = Field(ge=0.0, le=1.0)
    snippet: str
    match_type: Literal["keyword", "semantic"]
