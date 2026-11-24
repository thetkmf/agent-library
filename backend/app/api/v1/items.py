"""Item endpoints (contract §9.2)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query, Request, Response

from ...core.envelope import envelope
from ...schemas.common import Envelope, ErrorEnvelope, Page
from ...schemas.items import ItemCreate, ItemOut, ItemUpdate
from ...services import items as items_service
from ..deps import SessionDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorEnvelope, "description": "未认证"},
    404: {"model": ErrorEnvelope, "description": "资源不存在"},
    409: {"model": ErrorEnvelope, "description": "版本冲突或资源已存在"},
    422: {"model": ErrorEnvelope, "description": "参数校验失败"},
}

router = APIRouter(tags=["items"], dependencies=[Depends(require_token)])


@router.get(
    "/items",
    response_model=Envelope[Page[ItemOut]],
    responses=_ERROR_RESPONSES,
    summary="条目列表",
)
def list_items(
    session: SessionDep,
    type_filter: Annotated[list[str] | None, Query(alias="type")] = None,
    tag_id: Annotated[list[str] | None, Query()] = None,
    status: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
    created_from: Annotated[str | None, Query()] = None,
    created_to: Annotated[str | None, Query()] = None,
    sort: Annotated[str, Query()] = "created_at",
    order: Annotated[str, Query()] = "desc",
    page: Annotated[int, Query()] = 1,
    page_size: Annotated[int, Query()] = 20,
) -> dict[str, Any]:
    """Return a filtered, sorted page of items."""
    rows, total, has_more = items_service.list_items(
        session,
        types=type_filter,
        tag_ids=tag_id,
        status=status,
        q=q,
        created_from=created_from,
        created_to=created_to,
        sort=sort,
        order=order,
        page=page,
        page_size=page_size,
    )
    return envelope(
        Page[ItemOut](items=rows, page=page, page_size=page_size, total=total, has_more=has_more)
    )


@router.post(
    "/items",
    response_model=Envelope[ItemOut],
    status_code=201,
    responses=_ERROR_RESPONSES,
    summary="创建条目",
)
def create_item(
    session: SessionDep,
    payload: ItemCreate,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict[str, Any]:
    """Create a note / tex / file item."""
    return envelope(items_service.create_item(session, payload, idempotency_key=idempotency_key))


@router.get(
    "/items/{item_id}",
    response_model=Envelope[ItemOut],
    responses=_ERROR_RESPONSES,
    summary="条目详情",
)
def get_item(session: SessionDep, item_id: str) -> dict[str, Any]:
    """Return one item, including recycle-bin entries."""
    return envelope(items_service.get_item(session, item_id))


@router.patch(
    "/items/{item_id}",
    response_model=Envelope[ItemOut],
    responses=_ERROR_RESPONSES,
    summary="更新条目（标题/标签/状态）",
)
def update_item(
    session: SessionDep,
    item_id: str,
    payload: ItemUpdate,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> dict[str, Any]:
    """Patch title, tags or status with optimistic locking."""
    return envelope(items_service.update_item(session, item_id, payload, if_match=if_match))


@router.delete(
    "/items/{item_id}",
    response_model=Envelope[dict[str, str]],
    responses=_ERROR_RESPONSES,
    summary="软删除条目（进回收站）",
)
def delete_item(session: SessionDep, item_id: str) -> dict[str, Any]:
    """Move an item into the recycle bin and return its id."""
    items_service.delete_item(session, item_id)
    return envelope({"id": item_id})


@router.post(
    "/items/{item_id}/restore",
    response_model=Envelope[ItemOut],
    responses=_ERROR_RESPONSES,
    summary="从回收站恢复条目",
)
def restore_item(session: SessionDep, item_id: str) -> dict[str, Any]:
    """Restore an item from the recycle bin."""
    return envelope(items_service.restore_item(session, item_id))


@router.get(
    "/items/{item_id}/content",
    response_class=Response,
    responses={
        200: {"content": {"text/plain": {"schema": {"type": "string"}}}},
        400: {"model": ErrorEnvelope},
        401: {"model": ErrorEnvelope},
        404: {"model": ErrorEnvelope},
    },
    summary="读取正文（text/plain，不使用信封）",
)
def get_content(session: SessionDep, item_id: str) -> Response:
    """Return the raw content for the editor."""
    content = items_service.get_content(session, item_id)
    return Response(content=content, media_type="text/plain; charset=utf-8")


@router.put(
    "/items/{item_id}/content",
    response_model=Envelope[ItemOut],
    responses=_ERROR_RESPONSES,
    summary="保存正文（text/plain + expected_version）",
)
async def put_content(
    session: SessionDep,
    item_id: str,
    request: Request,
    expected_version: Annotated[int | None, Query()] = None,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> dict[str, Any]:
    """Persist the raw content sent as text/plain."""
    raw = await request.body()
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        content = raw.decode("utf-8", errors="replace")
    item = items_service.put_content(
        session,
        item_id,
        content,
        expected_version=expected_version,
        if_match=if_match,
    )
    return envelope(item)
