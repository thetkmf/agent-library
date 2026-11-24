"""Timeline endpoint (§9.2)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from ...core.envelope import envelope
from ...schemas.common import Envelope, ErrorEnvelope
from ...schemas.timeline import TimelineOut
from ...services import timeline as timeline_service
from ..deps import SessionDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "非法 tz / group_by / 时间区间 / cursor"},
    401: {"model": ErrorEnvelope, "description": "未认证"},
}

router = APIRouter(tags=["timeline"], dependencies=[Depends(require_token)])


@router.get(
    "/timeline",
    response_model=Envelope[TimelineOut],
    responses=_ERROR_RESPONSES,
    summary="时间轴分组（day/week/month）",
)
def get_timeline(
    session: SessionDep,
    from_: Annotated[str | None, Query(alias="from")] = None,
    to_: Annotated[str | None, Query(alias="to")] = None,
    group_by: Annotated[str, Query()] = "day",
    tz: Annotated[str, Query()] = "UTC",
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query()] = timeline_service.DEFAULT_LIMIT,
    type_filter: Annotated[list[str] | None, Query(alias="type")] = None,
    status: Annotated[str | None, Query()] = None,
    tag_id: Annotated[list[str] | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
) -> dict[str, Any]:
    """Group items by local day/week/month with stable cursor paging.

    Filters mirror ``GET /items``; ``status`` defaults to ``active``.
    """
    result = timeline_service.get_timeline(
        session,
        created_from=from_,
        created_to=to_,
        group_by=group_by,
        tz=tz,
        cursor=cursor,
        limit=limit,
        types=type_filter,
        status=status,
        tag_ids=tag_id,
        q=q,
    )
    return envelope(result)
