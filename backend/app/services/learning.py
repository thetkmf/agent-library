"""Learning plans, milestones and progress (B10)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from ..core.config import Settings
from ..core.errors import not_found, unsupported_query, validation_failed, version_conflict
from ..core.logging import get_logger
from ..db.base import utcnow
from ..db.models import LearningPlan, Milestone
from ..schemas.learning import (
    MilestoneCreate,
    MilestoneOut,
    MilestoneUpdate,
    PlanCreate,
    PlanOut,
    PlanPage,
    PlanUpdate,
    ProgressOut,
)

logger = get_logger("pkb.learning")


class LearningService:
    """Plan CRUD with optimistic locking and milestone-driven progress."""

    def __init__(self, settings: Settings, session_factory: sessionmaker[Session]) -> None:
        self.settings = settings
        self.session_factory = session_factory

    # ---- plans ------------------------------------------------------
    def list_plans(
        self, *, page: int = 1, page_size: int = 20, status: str | None = None
    ) -> PlanPage:
        if page < 1 or not 1 <= page_size <= 100:
            raise unsupported_query("分页参数超出范围")
        with self.session_factory() as session:
            stmt = select(LearningPlan)
            count_stmt = select(func.count()).select_from(LearningPlan)
            if status:
                stmt = stmt.where(LearningPlan.status == status)
                count_stmt = count_stmt.where(LearningPlan.status == status)
            total = int(session.scalar(count_stmt) or 0)
            rows = session.scalars(
                stmt.order_by(LearningPlan.updated_at.desc(), LearningPlan.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
            items = [_plan_out(row) for row in rows]
        return PlanPage(
            items=items,
            page=page,
            page_size=page_size,
            total=total,
            has_more=page * page_size < total,
        )

    def get_plan(self, plan_id: str) -> PlanOut:
        with self.session_factory() as session:
            return _plan_out(_load(session, plan_id))

    def create_plan(self, payload: PlanCreate) -> PlanOut:
        _validate_dates(payload.start_date, payload.target_date)
        with self.session_factory() as session:
            plan = LearningPlan(
                title=payload.title.strip(),
                goal=payload.goal,
                start_date=payload.start_date,
                target_date=payload.target_date,
                status=payload.status,
            )
            session.add(plan)
            session.flush()
            for index, milestone in enumerate(payload.milestones):
                plan.milestones.append(_new_milestone(milestone, default_order=index))
            session.commit()
            session.refresh(plan)
            return _plan_out(plan)

    def update_plan(self, plan_id: str, payload: PlanUpdate) -> PlanOut:
        with self.session_factory() as session:
            plan = _load(session, plan_id)
            if plan.version != payload.expected_version:
                raise version_conflict(data=_plan_out(plan).model_dump(mode="json"))
            start = payload.start_date if payload.start_date is not None else plan.start_date
            target = payload.target_date if payload.target_date is not None else plan.target_date
            _validate_dates(start, target)
            if payload.title is not None:
                plan.title = payload.title.strip()
            if payload.goal is not None:
                plan.goal = payload.goal
            if payload.start_date is not None:
                plan.start_date = payload.start_date
            if payload.target_date is not None:
                plan.target_date = payload.target_date
            if payload.status is not None:
                plan.status = payload.status
            plan.version += 1
            session.commit()
            session.refresh(plan)
            return _plan_out(plan)

    def delete_plan(self, plan_id: str) -> None:
        with self.session_factory() as session:
            plan = _load(session, plan_id)
            session.delete(plan)
            session.commit()

    # ---- milestones -------------------------------------------------
    def add_milestone(self, plan_id: str, payload: MilestoneCreate) -> MilestoneOut:
        with self.session_factory() as session:
            plan = _load(session, plan_id)
            milestone = _new_milestone(payload, default_order=len(plan.milestones))
            milestone.plan_id = plan.id
            session.add(milestone)
            plan.version += 1
            session.commit()
            session.refresh(milestone)
            return _milestone_out(milestone)

    def update_milestone(self, milestone_id: str, payload: MilestoneUpdate) -> MilestoneOut:
        with self.session_factory() as session:
            milestone = session.get(Milestone, milestone_id)
            if milestone is None:
                raise not_found("里程碑不存在")
            plan = session.get(LearningPlan, milestone.plan_id)
            if payload.title is not None:
                milestone.title = payload.title.strip()
            if payload.due_date is not None:
                milestone.due_date = payload.due_date
            if payload.sort_order is not None:
                milestone.sort_order = payload.sort_order
            _apply_milestone_state(
                milestone,
                status=payload.status,
                progress=payload.progress,
            )
            if plan is not None:
                plan.version += 1
            session.commit()
            session.refresh(milestone)
            return _milestone_out(milestone)

    def delete_milestone(self, milestone_id: str) -> None:
        with self.session_factory() as session:
            milestone = session.get(Milestone, milestone_id)
            if milestone is None:
                raise not_found("里程碑不存在")
            plan = session.get(LearningPlan, milestone.plan_id)
            session.delete(milestone)
            if plan is not None:
                plan.version += 1
            session.commit()

    # ---- progress ---------------------------------------------------
    def progress(self) -> ProgressOut:
        with self.session_factory() as session:
            plan_counts = dict(
                session.execute(
                    select(LearningPlan.status, func.count()).group_by(LearningPlan.status)
                ).all()
            )
            milestone_total = int(session.scalar(select(func.count()).select_from(Milestone)) or 0)
            milestone_done = int(
                session.scalar(
                    select(func.count()).select_from(Milestone).where(Milestone.status == "done")
                )
                or 0
            )
            completed_days = self._completed_days(session)
        total_plans = sum(int(value) for value in plan_counts.values())
        completion_rate = round(milestone_done / milestone_total, 2) if milestone_total else 0.0
        return ProgressOut(
            total_plans=total_plans,
            active_plans=int(plan_counts.get("active", 0)),
            done_plans=int(plan_counts.get("done", 0)),
            completion_rate=completion_rate,
            milestone_total=milestone_total,
            milestone_done=milestone_done,
            streak_days=_streak(completed_days, self._today()),
            updated_at=utcnow(),
        )

    def _completed_days(self, session: Session) -> set[date]:
        rows = session.scalars(
            select(Milestone.completed_at).where(Milestone.completed_at.is_not(None))
        ).all()
        zone = self._zone()
        days: set[date] = set()
        for value in rows:
            if value is None:
                continue
            moment = value if value.tzinfo else value.replace(tzinfo=UTC)
            days.add(moment.astimezone(zone).date())
        return days

    def _zone(self) -> ZoneInfo:
        try:
            return ZoneInfo(self.settings.timezone)
        except ZoneInfoNotFoundError:  # pragma: no cover
            return ZoneInfo("UTC")

    def _today(self) -> date:
        return datetime.now(self._zone()).date()


def _load(session: Session, plan_id: str) -> LearningPlan:
    plan = session.get(LearningPlan, plan_id)
    if plan is None:
        raise not_found("学习计划不存在")
    return plan


def _validate_dates(start: date | None, target: date | None) -> None:
    if start is not None and target is not None and target < start:
        raise validation_failed("target_date 不能早于 start_date")


def _new_milestone(payload: MilestoneCreate, *, default_order: int) -> Milestone:
    milestone = Milestone(
        title=payload.title.strip(),
        due_date=payload.due_date,
        status=payload.status,
        progress=payload.progress,
        sort_order=payload.sort_order if payload.sort_order else default_order,
    )
    _apply_milestone_state(milestone, status=payload.status, progress=payload.progress)
    return milestone


def _apply_milestone_state(
    milestone: Milestone, *, status: str | None, progress: int | None
) -> None:
    """Encode the contract rules for status/progress/completed_at."""
    if status == "done":
        milestone.status = "done"
        milestone.progress = 100
    elif progress is not None:
        milestone.progress = progress
        if progress == 100:
            milestone.status = "done"
        elif progress > 0 and status is None:
            milestone.status = "in_progress"
        elif status is not None:
            milestone.status = status
    elif status is not None:
        milestone.status = status
    if milestone.status == "done":
        if milestone.completed_at is None:
            milestone.completed_at = utcnow()
    else:
        milestone.completed_at = None


def _streak(days: set[date], today: date) -> int:
    streak = 0
    cursor = today
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _plan_out(plan: LearningPlan) -> PlanOut:
    milestones = sorted(plan.milestones, key=lambda row: (row.sort_order, row.created_at, row.id))
    return PlanOut(
        id=plan.id,
        title=plan.title,
        goal=plan.goal,
        start_date=plan.start_date,
        target_date=plan.target_date,
        status=plan.status,
        version=plan.version,
        milestones=[_milestone_out(row) for row in milestones],
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


def _milestone_out(milestone: Milestone) -> MilestoneOut:
    return MilestoneOut(
        id=milestone.id,
        plan_id=milestone.plan_id,
        title=milestone.title,
        due_date=milestone.due_date,
        status=milestone.status,
        progress=milestone.progress,
        sort_order=milestone.sort_order,
        completed_at=milestone.completed_at,
        created_at=milestone.created_at,
        updated_at=milestone.updated_at,
    )
