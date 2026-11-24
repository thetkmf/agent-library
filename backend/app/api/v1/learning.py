"""Learning plan endpoints (§9.8, B10)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, status

from ...core.envelope import envelope
from ...schemas.common import Envelope, ErrorEnvelope
from ...schemas.learning import (
    MilestoneCreate,
    MilestoneOut,
    MilestoneUpdate,
    PlanCreate,
    PlanOut,
    PlanPage,
    PlanUpdate,
    ProgressOut,
)
from ...services.learning import LearningService
from ..deps import SessionDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "参数不合法"},
    401: {"model": ErrorEnvelope, "description": "未认证"},
    404: {"model": ErrorEnvelope, "description": "计划/里程碑不存在"},
    409: {"model": ErrorEnvelope, "description": "版本冲突"},
}

router = APIRouter(prefix="/learning", tags=["learning"], dependencies=[Depends(require_token)])


def _service(request: Request) -> LearningService:
    service: LearningService = request.app.state.learning_service
    return service


@router.get(
    "/plans",
    response_model=Envelope[PlanPage],
    responses=_ERROR_RESPONSES,
    summary="计划列表（可按 status 过滤）",
)
def list_plans(
    request: Request,
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    plan_status: Annotated[str | None, Query(alias="status")] = None,
) -> dict[str, Any]:
    """List learning plans."""
    _ = session
    return envelope(
        _service(request).list_plans(page=page, page_size=page_size, status=plan_status)
    )


@router.post(
    "/plans",
    response_model=Envelope[PlanOut],
    status_code=status.HTTP_201_CREATED,
    responses=_ERROR_RESPONSES,
    summary="创建计划（可带里程碑）",
)
def create_plan(request: Request, payload: PlanCreate, session: SessionDep) -> dict[str, Any]:
    """Create a plan; ``target_date`` must not precede ``start_date``."""
    _ = session
    return envelope(_service(request).create_plan(payload))


@router.get(
    "/plans/{plan_id}",
    response_model=Envelope[PlanOut],
    responses=_ERROR_RESPONSES,
    summary="计划详情（含里程碑）",
)
def get_plan(request: Request, session: SessionDep, plan_id: str) -> dict[str, Any]:
    """Return one plan with milestones ordered by sort_order."""
    _ = session
    return envelope(_service(request).get_plan(plan_id))


@router.patch(
    "/plans/{plan_id}",
    response_model=Envelope[PlanOut],
    responses=_ERROR_RESPONSES,
    summary="更新计划（必须带 expected_version）",
)
def update_plan(
    request: Request, session: SessionDep, plan_id: str, payload: PlanUpdate
) -> dict[str, Any]:
    """Update a plan; stale version returns 409 + 30003 with the current plan."""
    _ = session
    return envelope(_service(request).update_plan(plan_id, payload))


@router.delete(
    "/plans/{plan_id}",
    response_model=Envelope[dict[str, str]],
    responses=_ERROR_RESPONSES,
    summary="删除计划（级联里程碑）",
)
def delete_plan(request: Request, session: SessionDep, plan_id: str) -> dict[str, Any]:
    """Delete a plan and its milestones."""
    _ = session
    _service(request).delete_plan(plan_id)
    return envelope({"id": plan_id})


@router.post(
    "/plans/{plan_id}/milestones",
    response_model=Envelope[MilestoneOut],
    status_code=status.HTTP_201_CREATED,
    responses=_ERROR_RESPONSES,
    summary="新增里程碑（计划版本 +1）",
)
def add_milestone(
    request: Request, session: SessionDep, plan_id: str, payload: MilestoneCreate
) -> dict[str, Any]:
    """Append a milestone; the owning plan's version is bumped."""
    _ = session
    return envelope(_service(request).add_milestone(plan_id, payload))


@router.patch(
    "/milestones/{milestone_id}",
    response_model=Envelope[MilestoneOut],
    responses=_ERROR_RESPONSES,
    summary="更新里程碑（进度/状态联动）",
)
def update_milestone(
    request: Request, session: SessionDep, milestone_id: str, payload: MilestoneUpdate
) -> dict[str, Any]:
    """Update milestone progress/status following the contract rules."""
    _ = session
    return envelope(_service(request).update_milestone(milestone_id, payload))


@router.delete(
    "/milestones/{milestone_id}",
    response_model=Envelope[dict[str, str]],
    responses=_ERROR_RESPONSES,
    summary="删除里程碑（计划版本 +1）",
)
def delete_milestone(request: Request, session: SessionDep, milestone_id: str) -> dict[str, Any]:
    """Delete a milestone."""
    _ = session
    _service(request).delete_milestone(milestone_id)
    return envelope({"id": milestone_id})


@router.get(
    "/progress",
    response_model=Envelope[ProgressOut],
    responses=_ERROR_RESPONSES,
    summary="学习进度汇总（计划数、完成率、连续学习天数）",
)
def progress(request: Request, session: SessionDep) -> dict[str, Any]:
    """Aggregate progress across all plans."""
    _ = session
    return envelope(_service(request).progress())
