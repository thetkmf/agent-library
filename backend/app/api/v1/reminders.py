"""Reminder endpoints (§9.7, B9)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, status

from ...core.envelope import envelope
from ...schemas.common import Envelope, ErrorEnvelope
from ...schemas.reminders import (
    ReminderCreate,
    ReminderOut,
    ReminderPage,
    ReminderUpdate,
    SnoozeRequest,
)
from ...services.reminders import ReminderService
from ..deps import SessionDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "参数不合法"},
    401: {"model": ErrorEnvelope, "description": "未认证"},
    404: {"model": ErrorEnvelope, "description": "提醒或条目不存在"},
    409: {"model": ErrorEnvelope, "description": "状态冲突"},
}

router = APIRouter(prefix="/reminders", tags=["reminders"], dependencies=[Depends(require_token)])


def _service(request: Request) -> ReminderService:
    service: ReminderService = request.app.state.reminder_service
    return service


def _reschedule(request: Request) -> None:
    scheduler = getattr(request.app.state, "reminder_scheduler", None)
    if scheduler is not None:
        scheduler.reschedule()


@router.get(
    "",
    response_model=Envelope[ReminderPage],
    responses=_ERROR_RESPONSES,
    summary="提醒列表（按提醒时间升序，可按 status/from/to 过滤）",
)
def list_reminders(
    request: Request,
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    reminder_status: Annotated[str | None, Query(alias="status")] = None,
    date_from: Annotated[str | None, Query(alias="from")] = None,
    date_to: Annotated[str | None, Query(alias="to")] = None,
) -> dict[str, Any]:
    """List reminders."""
    _ = session
    return envelope(
        _service(request).list_reminders(
            page=page,
            page_size=page_size,
            status=reminder_status,
            date_from=date_from,
            date_to=date_to,
        )
    )


@router.post(
    "",
    response_model=Envelope[ReminderOut],
    status_code=status.HTTP_201_CREATED,
    responses=_ERROR_RESPONSES,
    summary="创建提醒",
)
def create_reminder(
    request: Request, payload: ReminderCreate, session: SessionDep
) -> dict[str, Any]:
    """Create a reminder; ``remind_at`` must be in the future."""
    _ = session
    created = _service(request).create(payload)
    _reschedule(request)
    return envelope(created)


@router.patch(
    "/{reminder_id}",
    response_model=Envelope[ReminderOut],
    responses=_ERROR_RESPONSES,
    summary="修改提醒（标题/内容/时间/重复/关联条目）",
)
def update_reminder(
    request: Request, session: SessionDep, reminder_id: str, payload: ReminderUpdate
) -> dict[str, Any]:
    """Patch a reminder and reschedule it."""
    _ = session
    updated = _service(request).update(reminder_id, payload)
    _reschedule(request)
    return envelope(updated)


@router.delete(
    "/{reminder_id}",
    response_model=Envelope[ReminderOut],
    responses=_ERROR_RESPONSES,
    summary="取消提醒（幂等）",
)
def cancel_reminder(request: Request, session: SessionDep, reminder_id: str) -> dict[str, Any]:
    """Cancel a reminder."""
    _ = session
    canceled = _service(request).cancel(reminder_id)
    _reschedule(request)
    return envelope(canceled)


@router.post(
    "/{reminder_id}/done",
    response_model=Envelope[ReminderOut],
    responses=_ERROR_RESPONSES,
    summary="标记完成（重复规则自动生成下一次）",
)
def done_reminder(request: Request, session: SessionDep, reminder_id: str) -> dict[str, Any]:
    """Mark done; repeating reminders spawn the next occurrence."""
    _ = session
    result = _service(request).done(reminder_id)
    _reschedule(request)
    return envelope(result)


@router.post(
    "/{reminder_id}/snooze",
    response_model=Envelope[ReminderOut],
    responses=_ERROR_RESPONSES,
    summary="稍后提醒（1–10080 分钟）",
)
def snooze_reminder(
    request: Request, session: SessionDep, reminder_id: str, payload: SnoozeRequest
) -> dict[str, Any]:
    """Snooze a reminder."""
    _ = session
    result = _service(request).snooze(reminder_id, payload.minutes)
    _reschedule(request)
    return envelope(result)
