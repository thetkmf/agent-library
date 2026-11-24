"""Tag endpoints and item-tag association (§9.3)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from ...core.envelope import envelope
from ...schemas.common import Envelope, ErrorEnvelope
from ...schemas.items import ItemOut
from ...schemas.tags import AttachTagsRequest, TagCreate, TagOut, TagUpdate
from ...services import tags as tags_service
from ..deps import SessionDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorEnvelope, "description": "未认证"},
    404: {"model": ErrorEnvelope, "description": "资源不存在"},
    409: {"model": ErrorEnvelope, "description": "标签已存在"},
    422: {"model": ErrorEnvelope, "description": "参数校验失败"},
}

router = APIRouter(tags=["tags"], dependencies=[Depends(require_token)])


@router.get(
    "/tags",
    response_model=Envelope[list[TagOut]],
    responses=_ERROR_RESPONSES,
    summary="标签列表（含 item_count）",
)
def list_tags(session: SessionDep) -> dict[str, Any]:
    """Return all tags with active item counts, sorted by name."""
    return envelope(tags_service.list_tags(session))


@router.post(
    "/tags",
    response_model=Envelope[TagOut],
    status_code=201,
    responses=_ERROR_RESPONSES,
    summary="创建标签",
)
def create_tag(session: SessionDep, payload: TagCreate) -> dict[str, Any]:
    """Create a tag; duplicate names (case-insensitive) return 409 + 30002."""
    return envelope(tags_service.create_tag(session, payload))


@router.patch(
    "/tags/{tag_id}",
    response_model=Envelope[TagOut],
    responses=_ERROR_RESPONSES,
    summary="重命名标签",
)
def rename_tag(session: SessionDep, tag_id: str, payload: TagUpdate) -> dict[str, Any]:
    """Rename a tag."""
    return envelope(tags_service.rename_tag(session, tag_id, payload))


@router.delete(
    "/tags/{tag_id}",
    response_model=Envelope[dict[str, str]],
    responses=_ERROR_RESPONSES,
    summary="删除标签并解除关联",
)
def delete_tag(session: SessionDep, tag_id: str) -> dict[str, Any]:
    """Delete a tag; associated items are kept."""
    return envelope(tags_service.delete_tag(session, tag_id))


@router.post(
    "/items/{item_id}/tags",
    response_model=Envelope[ItemOut],
    responses=_ERROR_RESPONSES,
    summary="批量关联标签（幂等）",
)
def attach_tags(session: SessionDep, item_id: str, payload: AttachTagsRequest) -> dict[str, Any]:
    """Attach tags to an item; repeated associations are ignored."""
    return envelope(tags_service.attach_tags(session, item_id, payload))


@router.delete(
    "/items/{item_id}/tags/{tag_id}",
    response_model=Envelope[ItemOut],
    responses=_ERROR_RESPONSES,
    summary="解除标签关联",
)
def detach_tag(session: SessionDep, item_id: str, tag_id: str) -> dict[str, Any]:
    """Remove one tag association; a missing association returns 404 + 30001."""
    return envelope(tags_service.detach_tag(session, item_id, tag_id))
