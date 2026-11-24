"""Reminder payloads (§8.6 / 9.7, B9)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

RepeatRule = Literal["none", "daily", "weekly", "monthly"]


class ReminderCreate(BaseModel):
    """Body of POST /reminders."""

    title: str = Field(min_length=1, max_length=100)
    body: str | None = Field(default=None, max_length=2000)
    remind_at: datetime
    repeat_rule: RepeatRule = "none"
    related_item_ids: list[str] = Field(default_factory=list, max_length=50)


class ReminderUpdate(BaseModel):
    """Body of PATCH /reminders/{id} — only provided fields change."""

    title: str | None = Field(default=None, min_length=1, max_length=100)
    body: str | None = Field(default=None, max_length=2000)
    remind_at: datetime | None = None
    repeat_rule: RepeatRule | None = None
    related_item_ids: list[str] | None = Field(default=None, max_length=50)


class SnoozeRequest(BaseModel):
    """Body of POST /reminders/{id}/snooze."""

    minutes: int = Field(ge=1, le=10080)


class ReminderOut(BaseModel):
    """Reminder projection."""

    id: str
    title: str
    body: str | None = None
    remind_at: datetime
    repeat_rule: str
    related_item_ids: list[str] = Field(default_factory=list)
    status: str
    snooze_until: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ReminderPage(BaseModel):
    """Paginated reminder list."""

    items: list[ReminderOut] = Field(default_factory=list)
    page: int = 1
    page_size: int = 20
    total: int = 0
    has_more: bool = False


class EventAck(BaseModel):
    """Generic event payload wrapper."""

    event: str
    data: dict[str, Any] = Field(default_factory=dict)
