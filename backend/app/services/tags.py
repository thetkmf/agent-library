"""Tag business logic: CRUD, item_count, bulk attach / detach (§9.3)."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.errors import already_exists, not_found
from ..core.tags import validate_tag_name
from ..db.models import Item, Tag
from ..repositories import items as items_repo
from ..repositories import tags as repo
from ..schemas.items import ItemOut
from ..schemas.tags import AttachTagsRequest, TagCreate, TagOut, TagUpdate
from .items import to_item_out


def _to_tag_out(tag: Tag, item_count: int) -> TagOut:
    return TagOut(
        id=tag.id,
        name=tag.name,
        item_count=item_count,
        created_at=tag.created_at,
    )


def list_tags(session: Session) -> list[TagOut]:
    """Return every tag with the active item count, sorted by name."""
    return [_to_tag_out(tag, count) for tag, count in repo.list_tags_with_counts(session)]


def create_tag(session: Session, payload: TagCreate) -> TagOut:
    """Create a tag, rejecting case-insensitive duplicates with 409 + 30002."""
    name = validate_tag_name(payload.name)
    if repo.find_tag_by_casefold(session, name) is not None:
        raise already_exists("标签已存在")
    tag = Tag(name=name)
    try:
        repo.add_tag(session, tag)
    except IntegrityError as exc:
        session.rollback()
        raise already_exists("标签已存在") from exc
    session.commit()
    session.refresh(tag)
    return _to_tag_out(tag, 0)


def rename_tag(session: Session, tag_id: str, payload: TagUpdate) -> TagOut:
    """Rename a tag, keeping names unique under ``casefold``."""
    tag = repo.get_tag(session, tag_id)
    if tag is None:
        raise not_found("标签不存在")
    name = validate_tag_name(payload.name)
    if tag.name == name:
        return _to_tag_out(tag, repo.count_active_items_for_tag(session, tag_id))

    duplicate = repo.find_tag_by_casefold(session, name)
    if duplicate is not None and duplicate.id != tag.id:
        raise already_exists("标签已存在")
    tag.name = name
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise already_exists("标签已存在") from exc
    session.commit()
    session.refresh(tag)
    return _to_tag_out(tag, repo.count_active_items_for_tag(session, tag_id))


def delete_tag(session: Session, tag_id: str) -> dict[str, str]:
    """Delete a tag and its associations; items themselves are untouched."""
    tag = repo.get_tag(session, tag_id)
    if tag is None:
        raise not_found("标签不存在")
    repo.delete_tag(session, tag)
    session.commit()
    return {"id": tag_id}


def _load_item(session: Session, item_id: str) -> Item:
    item = items_repo.get_item(session, item_id)
    if item is None:
        raise not_found("条目不存在")
    if item.deleted_at is not None:
        raise not_found("条目在回收站中")
    return item


def _reload_item(session: Session, item_id: str) -> ItemOut:
    session.expire_all()
    return to_item_out(_load_item(session, item_id))


def attach_tags(session: Session, item_id: str, payload: AttachTagsRequest) -> ItemOut:
    """Attach tags in bulk; repeats are idempotent and unknown tags are 404."""
    _load_item(session, item_id)
    tag_ids = list(dict.fromkeys(payload.tag_ids))
    if tag_ids:
        found = {tag.id for tag in repo.get_tags_by_ids(session, tag_ids)}
        missing = [tag_id for tag_id in tag_ids if tag_id not in found]
        if missing:
            raise not_found("标签不存在", details={"tag_ids": missing})

    added = repo.attach_tags(session, item_id, tag_ids)
    if added:
        repo.touch_item(session, item_id)
    session.commit()
    return _reload_item(session, item_id)


def detach_tag(session: Session, item_id: str, tag_id: str) -> ItemOut:
    """Remove one association; a missing association returns 404 + 30001."""
    _load_item(session, item_id)
    if repo.get_tag(session, tag_id) is None:
        raise not_found("标签不存在")
    if not repo.detach_tag(session, item_id, tag_id):
        raise not_found("条目未关联该标签")

    repo.touch_item(session, item_id)
    session.commit()
    return _reload_item(session, item_id)
