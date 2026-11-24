"""Reminders: CRUD, repeat rollover, snooze and APScheduler-driven firing (B9)."""

from __future__ import annotations

import calendar
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from ..core.config import Settings
from ..core.errors import AppError, ErrorCode, not_found, unsupported_query, validation_failed
from ..core.logging import get_logger
from ..db.models import Item, Reminder
from ..schemas.reminders import (
    ReminderCreate,
    ReminderOut,
    ReminderPage,
    ReminderUpdate,
)
from .events import EventBus

logger = get_logger("pkb.reminders")

CLOCK_SKEW = timedelta(minutes=1)


def _now() -> datetime:
    """Naive UTC now — the column type stores naive UTC."""
    return datetime.now(UTC).replace(tzinfo=None)


def _naive(value: datetime | None) -> datetime | None:
    """Normalise possibly-aware datetimes to naive UTC for comparisons."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


REMINDER_EVENT = "reminder.due"


class ReminderService:
    """All reminder state transitions plus the due-scan used by the scheduler."""

    def __init__(
        self, settings: Settings, session_factory: sessionmaker[Session], bus: EventBus
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.bus = bus

    # ---- queries ----------------------------------------------------
    def list_reminders(
        self,
        *,
        page: int = 1,
        page_size: int = 20,
        status: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> ReminderPage:
        if page < 1 or not 1 <= page_size <= 100:
            raise unsupported_query("分页参数超出范围")
        with self.session_factory() as session:
            stmt = select(Reminder)
            count_stmt = select(func.count()).select_from(Reminder)
            if status:
                stmt = stmt.where(Reminder.status == status)
                count_stmt = count_stmt.where(Reminder.status == status)
            if date_from:
                bound = _parse_bound(date_from)
                stmt = stmt.where(Reminder.remind_at >= bound)
                count_stmt = count_stmt.where(Reminder.remind_at >= bound)
            if date_to:
                bound = _parse_bound(date_to)
                stmt = stmt.where(Reminder.remind_at <= bound)
                count_stmt = count_stmt.where(Reminder.remind_at <= bound)
            total = int(session.scalar(count_stmt) or 0)
            rows = session.scalars(
                stmt.order_by(Reminder.remind_at.asc(), Reminder.id.asc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
            items = [_out(row) for row in rows]
        return ReminderPage(
            items=items,
            page=page,
            page_size=page_size,
            total=total,
            has_more=page * page_size < total,
        )

    def get(self, reminder_id: str) -> ReminderOut:
        with self.session_factory() as session:
            return _out(_load(session, reminder_id))

    # ---- mutations --------------------------------------------------
    def create(self, payload: ReminderCreate) -> ReminderOut:
        remind_at = _to_utc(payload.remind_at)
        if remind_at < _now() - CLOCK_SKEW:
            raise validation_failed("提醒时间必须晚于当前时间")
        with self.session_factory() as session:
            _ensure_items(session, payload.related_item_ids)
            reminder = Reminder(
                title=payload.title.strip(),
                body=payload.body,
                remind_at=remind_at,
                repeat_rule=payload.repeat_rule,
                related_item_ids=list(payload.related_item_ids),
            )
            session.add(reminder)
            session.commit()
            session.refresh(reminder)
            out = _out(reminder)
        return out

    def update(self, reminder_id: str, payload: ReminderUpdate) -> ReminderOut:
        with self.session_factory() as session:
            reminder = _load(session, reminder_id)
            if payload.title is not None:
                reminder.title = payload.title.strip()
            if payload.body is not None:
                reminder.body = payload.body
            if payload.remind_at is not None:
                remind_at = _to_utc(payload.remind_at)
                if remind_at < _now() - CLOCK_SKEW:
                    raise validation_failed("提醒时间必须晚于当前时间")
                reminder.remind_at = remind_at
                reminder.last_notified_at = None
            if payload.repeat_rule is not None:
                reminder.repeat_rule = payload.repeat_rule
            if payload.related_item_ids is not None:
                _ensure_items(session, payload.related_item_ids)
                reminder.related_item_ids = list(payload.related_item_ids)
            session.commit()
            session.refresh(reminder)
            return _out(reminder)

    def cancel(self, reminder_id: str) -> ReminderOut:
        with self.session_factory() as session:
            reminder = _load(session, reminder_id)
            if reminder.status != "canceled":
                reminder.status = "canceled"
                session.commit()
                session.refresh(reminder)
            return _out(reminder)

    def done(self, reminder_id: str) -> ReminderOut:
        """Mark done; a repeating reminder spawns its next occurrence."""
        with self.session_factory() as session:
            reminder = _load(session, reminder_id)
            _reject_canceled(reminder)
            if reminder.status == "done":
                return _out(reminder)
            reminder.status = "done"
            reminder.snooze_until = None
            next_out = None
            if reminder.repeat_rule != "none":
                next_out = _spawn_next(session, reminder)
            session.commit()
            session.refresh(reminder)
            out = _out(reminder)
        if next_out is not None:
            logger.info("reminder.repeat_created", extra={"fields": {"reminder_id": next_out.id}})
        return out

    def snooze(self, reminder_id: str, minutes: int) -> ReminderOut:
        if not 1 <= minutes <= 10080:
            raise unsupported_query("minutes 必须在 1 到 10080 之间")
        with self.session_factory() as session:
            reminder = _load(session, reminder_id)
            _reject_canceled(reminder)
            if reminder.status == "done":
                raise AppError(
                    ErrorCode.ALREADY_EXISTS,
                    "提醒已完成，无法稍后提醒",
                    http_status=409,
                    data=_out(reminder).model_dump(mode="json"),
                )
            reminder.status = "snoozed"
            reminder.snooze_until = _now() + timedelta(minutes=minutes)
            reminder.last_notified_at = None
            session.commit()
            session.refresh(reminder)
            return _out(reminder)

    # ---- firing -----------------------------------------------------
    def fire_due(self, now: datetime | None = None) -> list[ReminderOut]:
        """Publish reminder.due for every occurrence that became due."""
        moment = _naive(now or _now())
        assert moment is not None
        fired: list[ReminderOut] = []
        with self.session_factory() as session:
            rows = session.scalars(
                select(Reminder).where(Reminder.status.in_(("pending", "snoozed")))
            ).all()
            for reminder in rows:
                effective = _naive(
                    reminder.snooze_until if reminder.status == "snoozed" else reminder.remind_at
                )
                if effective is None or effective > moment:
                    continue
                last_notified = _naive(reminder.last_notified_at)
                if last_notified is not None and last_notified >= effective:
                    continue
                reminder.last_notified_at = moment
                if reminder.status == "snoozed":
                    reminder.status = "pending"
                    reminder.snooze_until = None
                fired.append(_out(reminder))
            if fired:
                session.commit()
        for out in fired:
            self.bus.publish(REMINDER_EVENT, out.model_dump(mode="json"))
        return fired

    def recover(self) -> list[ReminderOut]:
        """Startup / wake-up catch-up: publish anything already due (once per occurrence)."""
        return self.fire_due()

    # ---- helpers for the scheduler ----------------------------------
    def local_timezone(self) -> ZoneInfo:
        try:
            return ZoneInfo(self.settings.timezone)
        except ZoneInfoNotFoundError:  # pragma: no cover - tzdata 缺失时回退 UTC
            return ZoneInfo("UTC")

    def upcoming(self, limit: int = 500) -> list[ReminderOut]:
        with self.session_factory() as session:
            rows = session.scalars(
                select(Reminder)
                .where(Reminder.status.in_(("pending", "snoozed")))
                .order_by(Reminder.remind_at.asc())
                .limit(limit)
            ).all()
            return [_out(row) for row in rows]


class ReminderScheduler:
    """Thin APScheduler wrapper: per-reminder date job + periodic safety scan."""

    def __init__(self, service: ReminderService, *, interval_s: int) -> None:
        self.service = service
        self.interval_s = interval_s
        self._scheduler: object | None = None

    def start(self) -> None:
        from apscheduler.schedulers.background import BackgroundScheduler

        scheduler = BackgroundScheduler(timezone=str(self.service.local_timezone()))
        scheduler.add_job(
            self._scan,
            "interval",
            seconds=self.interval_s,
            id="reminders-scan",
            replace_existing=True,
        )
        for reminder in self.service.upcoming():
            due = reminder.snooze_until or reminder.remind_at
            scheduler.add_job(
                self._scan,
                "date",
                run_date=due,
                id=f"reminder-{reminder.id}",
                replace_existing=True,
            )
        scheduler.start()
        self._scheduler = scheduler

    def reschedule(self) -> None:
        """Rebuild pending jobs after a reminder changed (cheap: drop & re-add)."""
        if self._scheduler is None:
            return
        scheduler = self._scheduler
        for job in list(scheduler.get_jobs()):  # type: ignore[attr-defined]
            if job.id.startswith("reminder-"):
                job.remove()
        for reminder in self.service.upcoming():
            due = reminder.snooze_until or reminder.remind_at
            scheduler.add_job(  # type: ignore[attr-defined]
                self._scan,
                "date",
                run_date=due,
                id=f"reminder-{reminder.id}",
                replace_existing=True,
            )

    def shutdown(self) -> None:
        if self._scheduler is not None:
            self._scheduler.shutdown(wait=False)  # type: ignore[attr-defined]
            self._scheduler = None

    def _scan(self) -> None:
        try:
            self.service.fire_due()
        except Exception as exc:  # pragma: no cover - 调度线程不能抛
            logger.warning(
                "reminders.scan_failed", extra={"fields": {"reason": type(exc).__name__}}
            )


def _load(session: Session, reminder_id: str) -> Reminder:
    reminder = session.get(Reminder, reminder_id)
    if reminder is None:
        raise not_found("提醒不存在")
    return reminder


def _reject_canceled(reminder: Reminder) -> None:
    if reminder.status == "canceled":
        raise AppError(
            ErrorCode.ALREADY_EXISTS,
            "提醒已取消",
            http_status=409,
            data=_out(reminder).model_dump(mode="json"),
        )


def _ensure_items(session: Session, item_ids: Sequence[str]) -> None:
    if not item_ids:
        return
    unique = list(dict.fromkeys(item_ids))
    if len(unique) > 50:
        raise unsupported_query("related_item_ids 最多 50 个")
    found = set(session.scalars(select(Item.id).where(Item.id.in_(unique))).all())
    missing = [item_id for item_id in unique if item_id not in found]
    if missing:
        raise AppError(
            ErrorCode.NOT_FOUND, "关联条目不存在", http_status=404, data={"missing": missing}
        )


def _spawn_next(session: Session, reminder: Reminder) -> Reminder | None:
    base = reminder.remind_at
    if reminder.repeat_rule == "daily":
        next_at = base + timedelta(days=1)
    elif reminder.repeat_rule == "weekly":
        next_at = base + timedelta(days=7)
    elif reminder.repeat_rule == "monthly":
        next_at = _add_month(base)
    else:
        return None
    successor = Reminder(
        title=reminder.title,
        body=reminder.body,
        remind_at=next_at,
        repeat_rule=reminder.repeat_rule,
        related_item_ids=list(reminder.related_item_ids or []),
        status="pending",
    )
    session.add(successor)
    session.flush()
    return successor


def _add_month(value: datetime) -> datetime:
    year = value.year + (1 if value.month == 12 else 0)
    month = 1 if value.month == 12 else value.month + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _parse_bound(raw: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise unsupported_query("时间格式不合法，请使用 ISO 8601") from exc
    return _to_utc(parsed)


def _out(reminder: Reminder) -> ReminderOut:
    return ReminderOut(
        id=reminder.id,
        title=reminder.title,
        body=reminder.body,
        remind_at=reminder.remind_at,
        repeat_rule=reminder.repeat_rule,
        related_item_ids=list(reminder.related_item_ids or []),
        status=reminder.status,
        snooze_until=reminder.snooze_until,
        created_at=reminder.created_at,
        updated_at=reminder.updated_at,
    )
