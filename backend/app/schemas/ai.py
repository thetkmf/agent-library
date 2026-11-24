"""AI automation payloads: tasks, suggestions, profile (§9.6, B8)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

TASK_TYPE_VALUES = (
    "organize",
    "summarize",
    "tagging",
    "linking",
    "profile_refresh",
    "graph_build",
)
SUGGESTION_TYPE_VALUES = ("tag", "link", "summary")
SUGGESTION_STATUS_VALUES = ("pending", "accepted", "rejected")


class AiTaskCreate(BaseModel):
    """Body of POST /ai/tasks."""

    type: Literal["organize", "summarize", "tagging", "linking", "profile_refresh", "graph_build"]
    item_ids: list[str] = Field(default_factory=list, max_length=50)
    options: dict[str, Any] = Field(default_factory=dict)


class AiTaskOut(BaseModel):
    """Task shape shared by create/list/detail responses."""

    id: str
    type: str
    status: str
    progress: int
    input: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AiTaskPage(BaseModel):
    """Paginated task list."""

    items: list[AiTaskOut] = Field(default_factory=list)
    page: int = 1
    page_size: int = 20
    total: int = 0
    has_more: bool = False


class SuggestionOut(BaseModel):
    """One automation suggestion."""

    id: str
    type: str
    item_id: str
    payload: dict[str, Any] = Field(default_factory=dict)
    status: str
    created_at: datetime
    decided_at: datetime | None = None


class SuggestionPage(BaseModel):
    """Paginated suggestion list."""

    items: list[SuggestionOut] = Field(default_factory=list)
    page: int = 1
    page_size: int = 20
    total: int = 0
    has_more: bool = False


class ProfileOut(BaseModel):
    """User profile (§8.9)."""

    interests: list[str] = Field(default_factory=list)
    knowledge_domains: list[dict[str, Any]] = Field(default_factory=list)
    learning_goals: list[str] = Field(default_factory=list)
    preferred_style: str | None = None
    updated_at: datetime | None = None
