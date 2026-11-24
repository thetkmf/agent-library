"""Index endpoints: reindex task and status (§9.5)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from ...core.envelope import envelope
from ...schemas.common import Envelope, ErrorEnvelope
from ...schemas.index import IndexStatusOut, ReindexAccepted, ReindexRequest
from ..deps import SettingsDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "参数不合法"},
    401: {"model": ErrorEnvelope, "description": "未认证"},
    409: {"model": ErrorEnvelope, "description": "已有任务在执行 / 模型未就绪"},
}

router = APIRouter(tags=["index"], dependencies=[Depends(require_token)])


def _service(request: Request) -> Any:
    return request.app.state.index_service


@router.post(
    "/index/reindex",
    response_model=Envelope[ReindexAccepted],
    status_code=202,
    responses=_ERROR_RESPONSES,
    summary="触发增量/全量重建（202 + 任务）",
)
def start_reindex(
    request: Request,
    settings: SettingsDep,
    payload: ReindexRequest | None = None,
) -> dict[str, Any]:
    """Queue a reindex task; 409 when one is already running."""
    _ = settings
    mode = (payload or ReindexRequest()).mode
    task = _service(request).start_reindex(mode)
    return envelope(_service(request).task_payload(task))


@router.get(
    "/index/status",
    response_model=Envelope[IndexStatusOut],
    responses={401: {"model": ErrorEnvelope}},
    summary="索引状态（嵌入、已索引、待索引、最近任务）",
)
def get_index_status(request: Request) -> dict[str, Any]:
    """Return counters, embedding state and the latest task."""
    status = _service(request).status()
    return envelope(
        IndexStatusOut(
            ready=status.ready,
            indexed_count=status.indexed_count,
            pending_count=status.pending_count,
            last_updated_at=status.last_updated_at,
            embedding={
                "model": status.embedding_model,
                "dimension": status.embedding_dimension,
                "status": status.embedding_status,
            },
            task=(
                {
                    "id": status.task_id,
                    "status": status.task_status,
                    "progress": status.task_progress,
                }
                if status.task_id
                else None
            ),
        )
    )
