"""AI automation endpoints: tasks, suggestions, profile (§9.6, B8)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, status

from ...core.envelope import envelope
from ...schemas.ai import (
    AiTaskCreate,
    AiTaskOut,
    AiTaskPage,
    ProfileOut,
    SuggestionOut,
    SuggestionPage,
)
from ...schemas.common import Envelope, ErrorEnvelope
from ...services.ai_tasks import AiTaskService
from ..deps import SessionDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "参数不合法"},
    401: {"model": ErrorEnvelope, "description": "未认证"},
    404: {"model": ErrorEnvelope, "description": "任务/建议/条目不存在"},
    409: {"model": ErrorEnvelope, "description": "模型未配置或状态冲突"},
}

router = APIRouter(prefix="/ai", tags=["ai"], dependencies=[Depends(require_token)])


def _service(request: Request) -> AiTaskService:
    service: AiTaskService = request.app.state.ai_task_service
    return service


@router.post(
    "/tasks",
    response_model=Envelope[AiTaskOut],
    status_code=status.HTTP_202_ACCEPTED,
    responses=_ERROR_RESPONSES,
    summary="创建 AI 任务（organize/summarize/tagging/linking/profile_refresh/graph_build）",
)
def create_task(request: Request, payload: AiTaskCreate, session: SessionDep) -> dict[str, Any]:
    """Enqueue one AI task; requires a configured model and external-call consent."""
    _ = session
    return envelope(_service(request).create_task(payload))


@router.get(
    "/tasks",
    response_model=Envelope[AiTaskPage],
    responses=_ERROR_RESPONSES,
    summary="任务列表（按创建时间倒序，可按 status/type 过滤）",
)
def list_tasks(
    request: Request,
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    task_status: Annotated[str | None, Query(alias="status")] = None,
    task_type: Annotated[str | None, Query(alias="type")] = None,
) -> dict[str, Any]:
    """List tasks with filters."""
    _ = session
    return envelope(
        _service(request).list_tasks(
            page=page, page_size=page_size, status=task_status, task_type=task_type
        )
    )


@router.get(
    "/tasks/{task_id}",
    response_model=Envelope[AiTaskOut],
    responses=_ERROR_RESPONSES,
    summary="任务详情",
)
def get_task(request: Request, session: SessionDep, task_id: str) -> dict[str, Any]:
    """Return one task."""
    _ = session
    return envelope(_service(request).get_task(task_id))


@router.post(
    "/tasks/{task_id}/cancel",
    response_model=Envelope[AiTaskOut],
    responses=_ERROR_RESPONSES,
    summary="取消任务（仅 queued/running）",
)
def cancel_task(request: Request, session: SessionDep, task_id: str) -> dict[str, Any]:
    """Cancel a queued or running task."""
    _ = session
    return envelope(_service(request).cancel_task(task_id))


@router.get(
    "/suggestions",
    response_model=Envelope[SuggestionPage],
    responses=_ERROR_RESPONSES,
    summary="整理建议列表（可按 status/type/item_id 过滤）",
)
def list_suggestions(
    request: Request,
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    suggestion_status: Annotated[str | None, Query(alias="status")] = None,
    suggestion_type: Annotated[str | None, Query(alias="type")] = None,
    item_id: Annotated[str | None, Query()] = None,
) -> dict[str, Any]:
    """List automation suggestions."""
    _ = session
    return envelope(
        _service(request).list_suggestions(
            page=page,
            page_size=page_size,
            status=suggestion_status,
            kind=suggestion_type,
            item_id=item_id,
        )
    )


@router.post(
    "/suggestions/{suggestion_id}/accept",
    response_model=Envelope[SuggestionOut],
    responses=_ERROR_RESPONSES,
    summary="采纳建议（tag→关联标签，link→建图边，summary→写 ai_summary）",
)
def accept_suggestion(request: Request, session: SessionDep, suggestion_id: str) -> dict[str, Any]:
    """Apply a suggestion atomically; repeated accept is idempotent."""
    _ = session
    return envelope(_service(request).accept_suggestion(suggestion_id))


@router.post(
    "/suggestions/{suggestion_id}/reject",
    response_model=Envelope[SuggestionOut],
    responses=_ERROR_RESPONSES,
    summary="拒绝建议",
)
def reject_suggestion(request: Request, session: SessionDep, suggestion_id: str) -> dict[str, Any]:
    """Reject a pending suggestion."""
    _ = session
    return envelope(_service(request).reject_suggestion(suggestion_id))


@router.get(
    "/profile",
    response_model=Envelope[ProfileOut],
    responses=_ERROR_RESPONSES,
    summary="用户画像",
)
def get_profile(request: Request, session: SessionDep) -> dict[str, Any]:
    """Return the stored profile (empty payload when never refreshed)."""
    _ = session
    return envelope(_service(request).get_profile())


@router.post(
    "/profile/refresh",
    response_model=Envelope[AiTaskOut],
    status_code=status.HTTP_202_ACCEPTED,
    responses=_ERROR_RESPONSES,
    summary="触发画像刷新（202 任务）",
)
def refresh_profile(request: Request, session: SessionDep) -> dict[str, Any]:
    """Enqueue a profile_refresh task."""
    _ = session
    return envelope(_service(request).refresh_profile())
