"""Search endpoint (§9.5, B6)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request

from ...core.envelope import envelope
from ...schemas.common import Envelope, ErrorEnvelope
from ...schemas.search import SearchHitOut, SearchItemRef, SearchResponse
from ..deps import SessionDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "参数不合法"},
    401: {"model": ErrorEnvelope, "description": "未认证"},
}

router = APIRouter(tags=["search"], dependencies=[Depends(require_token)])


@router.get(
    "/search",
    response_model=Envelope[SearchResponse],
    responses=_ERROR_RESPONSES,
    summary="检索：关键词 / 语义 / 混合（RRF）",
)
def search(
    request: Request,
    session: SessionDep,
    q: Annotated[str, Query()],
    mode: Annotated[str, Query()] = "hybrid",
    limit: Annotated[int, Query()] = 20,
    type_filter: Annotated[list[str] | None, Query(alias="type")] = None,
    tag_id: Annotated[list[str] | None, Query()] = None,
) -> dict[str, Any]:
    """Search active items; embeddings unavailable degrades to keyword search."""
    _ = session
    service = request.app.state.search_service
    result = service.search(q=q, mode=mode, limit=limit, types=type_filter, tag_ids=tag_id)
    return envelope(
        SearchResponse(
            items=[
                SearchHitOut(
                    item=SearchItemRef(id=hit.item.id, type=hit.item.type, title=hit.item.title),
                    score=round(hit.score, 6),
                    snippet=hit.snippet,
                    match_type=hit.match_type,
                )
                for hit in result.items
            ],
            total=result.total,
            mode=result.mode,
            degraded=result.degraded,
        )
    )
