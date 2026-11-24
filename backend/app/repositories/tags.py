"""Tag and item-tag persistence helpers (§8.2, §9.3)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from ..db.base import utcnow
from ..db.models import Item, ItemTag, Tag


def list_tags_with_counts(session: Session) -> list[tuple[Tag, int]]:
    """Return every tag with the number of active, non-deleted items."""
    count_stmt = (
        select(func.count(ItemTag.item_id))
        .join(Item, Item.id == ItemTag.item_id)
        .where(
            ItemTag.tag_id == Tag.id,
            Item.status == "active",
            Item.deleted_at.is_(None),
        )
        .correlate(Tag)
        .scalar_subquery()
    )
    stmt = select(Tag, count_stmt.label("item_count")).order_by(Tag.name.asc(), Tag.id.asc())
    rows = session.execute(stmt).all()
    return [(row[0], int(row[1] or 0)) for row in rows]


def count_active_items_for_tag(session: Session, tag_id: str) -> int:
    """Count active, non-deleted items linked to one tag."""
    stmt = (
        select(func.count(ItemTag.item_id))
        .join(Item, Item.id == ItemTag.item_id)
        .where(
            ItemTag.tag_id == tag_id,
            Item.status == "active",
            Item.deleted_at.is_(None),
        )
    )
    return int(session.scalar(stmt) or 0)


def get_tag(session: Session, tag_id: str) -> Tag | None:
    """Load one tag by id."""
    return session.get(Tag, tag_id)


def find_tag_by_casefold(session: Session, name: str) -> Tag | None:
    """Find a tag whose name matches case-insensitively."""
    key = name.casefold()
    for tag in session.scalars(select(Tag)).all():
        if tag.name.casefold() == key:
            return tag
    return None


def get_tags_by_ids(session: Session, tag_ids: list[str]) -> list[Tag]:
    """Load tags for the requested ids (unknown ids are simply absent)."""
    if not tag_ids:
        return []
    return list(session.scalars(select(Tag).where(Tag.id.in_(tag_ids))).all())


def add_tag(session: Session, tag: Tag) -> Tag:
    """Persist a new tag."""
    session.add(tag)
    session.flush()
    return tag


def delete_tag(session: Session, tag: Tag) -> None:
    """Delete a tag; ``item_tags`` rows cascade, items are never touched."""
    session.delete(tag)
    session.flush()


def attached_tag_ids(session: Session, item_id: str) -> set[str]:
    """Return the set of tag ids currently attached to an item."""
    return set(session.scalars(select(ItemTag.tag_id).where(ItemTag.item_id == item_id)).all())


def attach_tags(session: Session, item_id: str, tag_ids: list[str]) -> int:
    """Attach tags idempotently; returns how many new links were created."""
    existing = attached_tag_ids(session, item_id)
    added = 0
    for tag_id in dict.fromkeys(tag_ids):
        if tag_id in existing:
            continue
        session.add(ItemTag(item_id=item_id, tag_id=tag_id))
        existing.add(tag_id)
        added += 1
    if added:
        session.flush()
    return added


def detach_tag(session: Session, item_id: str, tag_id: str) -> bool:
    """Remove one association; returns False when it did not exist."""
    stmt = delete(ItemTag).where(ItemTag.item_id == item_id, ItemTag.tag_id == tag_id)
    result: CursorResult[Any] = session.execute(stmt)  # type: ignore[assignment]
    session.flush()
    return bool(result.rowcount)


def touch_item(session: Session, item_id: str) -> None:
    """Bump an item's version after a tag mutation (atomic, no pre-read)."""
    stmt = (
        update(Item).where(Item.id == item_id).values(version=Item.version + 1, updated_at=utcnow())
    )
    session.execute(stmt)
    session.flush()
