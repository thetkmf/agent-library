"""Knowledge graph endpoints (§9.9, B11)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request

from ...core.envelope import envelope
from ...schemas.common import Envelope, ErrorEnvelope
from ...schemas.graph import GraphOut, GraphStatsOut
from ...services.graph import DEFAULT_DEPTH, DEFAULT_LIMIT, GraphService
from ..deps import SessionDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "参数不合法"},
    401: {"model": ErrorEnvelope, "description": "未认证"},
    404: {"model": ErrorEnvelope, "description": "节点/条目不存在"},
}

router = APIRouter(prefix="/graph", tags=["graph"], dependencies=[Depends(require_token)])


def _service(request: Request) -> GraphService:
    service: GraphService = request.app.state.graph_service
    return service


@router.get(
    "",
    response_model=Envelope[GraphOut],
    responses=_ERROR_RESPONSES,
    summary="全图/子图（center_id + depth，或按权重截断）",
)
def get_graph(
    request: Request,
    session: SessionDep,
    center_id: Annotated[str | None, Query()] = None,
    depth: Annotated[int, Query(ge=1, le=4)] = DEFAULT_DEPTH,
    types: Annotated[list[str] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=2000)] = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """Return nodes plus edges whose both ends are in the result set."""
    _ = session
    return envelope(
        _service(request).subgraph(center_id=center_id, depth=depth, types=types, limit=limit)
    )


@router.get(
    "/neighbors/{item_id}",
    response_model=Envelope[GraphOut],
    responses=_ERROR_RESPONSES,
    summary="条目的直接邻居子图",
)
def neighbors(request: Request, session: SessionDep, item_id: str) -> dict[str, Any]:
    """Return the item node and its direct neighbours."""
    _ = session
    return envelope(_service(request).neighbors(item_id))


@router.get(
    "/stats",
    response_model=Envelope[GraphStatsOut],
    responses=_ERROR_RESPONSES,
    summary="节点数、边数、孤立节点数",
)
def stats(request: Request, session: SessionDep) -> dict[str, Any]:
    """Return graph counters."""
    _ = session
    return envelope(_service(request).stats())
