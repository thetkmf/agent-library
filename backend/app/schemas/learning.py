"""Learning plan payloads (§8.7 / 9.8, B10)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

PlanStatus = Literal["planning", "active", "done", "archived"]
MilestoneStatus = Literal["todo", "in_progress", "done"]


class MilestoneCreate(BaseModel):
    """Milestone to add to a plan."""

    title: str = Field(min_length=1, max_length=200)
    due_date: date | None = None
    status: MilestoneStatus = "todo"
    progress: int = Field(default=0, ge=0, le=100)
    sort_order: int = 0


class MilestoneUpdate(BaseModel):
    """Partial milestone update."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    due_date: date | None = None
    status: MilestoneStatus | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    sort_order: int | None = None


class MilestoneOut(BaseModel):
    """Milestone projection."""

    id: str
    plan_id: str
    title: str
    due_date: date | None = None
    status: str
    progress: int
    sort_order: int
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class PlanCreate(BaseModel):
    """Body of POST /learning/plans."""

    title: str = Field(min_length=1, max_length=200)
    goal: str | None = Field(default=None, max_length=2000)
    start_date: date | None = None
    target_date: date | None = None
    status: PlanStatus = "planning"
    milestones: list[MilestoneCreate] = Field(default_factory=list, max_length=100)


class PlanUpdate(BaseModel):
    """Body of PATCH /learning/plans/{id}; ``expected_version`` is mandatory."""

    expected_version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    goal: str | None = Field(default=None, max_length=2000)
    start_date: date | None = None
    target_date: date | None = None
    status: PlanStatus | None = None


class PlanOut(BaseModel):
    """Learning plan with milestones."""

    id: str
    title: str
    goal: str | None = None
    start_date: date | None = None
    target_date: date | None = None
    status: str
    version: int
    milestones: list[MilestoneOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class PlanPage(BaseModel):
    """Paginated plan list."""

    items: list[PlanOut] = Field(default_factory=list)
    page: int = 1
    page_size: int = 20
    total: int = 0
    has_more: bool = False


class ProgressOut(BaseModel):
    """Aggregate learning progress."""

    total_plans: int = 0
    active_plans: int = 0
    done_plans: int = 0
    completion_rate: float = 0.0
    milestone_total: int = 0
    milestone_done: int = 0
    streak_days: int = 0
    updated_at: datetime
