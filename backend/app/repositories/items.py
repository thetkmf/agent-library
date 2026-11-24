"""Item and tag persistence helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, Select, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..db.base import utcnow
from ..db.models import Item, ItemTag, Tag

SORTABLE_COLUMNS = {
    "created_at": Item.created_at,
    "updated_at": Item.updated_at,
    "title": Item.title,
}


@dataclass(frozen=True, slots=True)
class ItemFilters:
    """Resolved list filters."""

    types: tuple[str, ...] = ()
    tag_ids: tuple[str, ...] = ()
    status: str | None = None
    q: str | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None


def _apply_filters(stmt: Select[Any], filters: ItemFilters) -> Select[Any]:
    if filters.status is None:
        stmt = stmt.where(Item.deleted_at.is_(None))
    elif filters.status != "trashed":
        stmt = stmt.where(Item.status == filters.status, Item.deleted_at.is_(None))
    else:
        stmt = stmt.where(Item.status == "trashed")
    if filters.types:
        stmt = stmt.where(Item.type.in_(filters.types))
    if filters.tag_ids:
        stmt = stmt.join(ItemTag, ItemTag.item_id == Item.id).where(
            ItemTag.tag_id.in_(filters.tag_ids)
        )
    if filters.q:
        pattern = f"%{filters.q}%"
        stmt = stmt.where(
            Item.title.like(pattern)
            | func.coalesce(Item.content, "").like(pattern)
            | Item.preview.like(pattern)
        )
    if filters.created_from is not None:
        stmt = stmt.where(Item.created_at >= filters.created_from)
    if filters.created_to is not None:
        stmt = stmt.where(Item.created_at <= filters.created_to)
    return stmt


def list_items(
    session: Session,
    filters: ItemFilters,
    *,
    sort: str,
    descending: bool,
    page: int,
    page_size: int,
) -> tuple[list[Item], int]:
    """Return one page of items plus the filtered total."""
    column = SORTABLE_COLUMNS[sort]
    base = _apply_filters(select(Item), filters)
    total = session.scalar(select(func.count()).select_from(base.order_by(None).subquery()))
    ordering: list[ColumnElement[Any]] = [
        column.desc() if descending else column.asc(),
        Item.id.desc() if descending else Item.id.asc(),
    ]
    stmt = (
        base.options(selectinload(Item.tags), selectinload(Item.file_asset))
        .order_by(*ordering)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list(session.scalars(stmt).all()), int(total or 0)


def get_item(session: Session, item_id: str) -> Item | None:
    """Load one item with tags and file asset."""
    stmt = (
        select(Item)
        .where(Item.id == item_id)
        .options(selectinload(Item.tags), selectinload(Item.file_asset))
    )
    return session.scalars(stmt).first()


def add_item(session: Session, item: Item) -> Item:
    """Persist a new item."""
    session.add(item)
    session.flush()
    return item


def update_item(
    session: Session,
    item_id: str,
    values: dict[str, Any],
    *,
    expected_version: int,
) -> Item | None:
    """Atomically bump the version; returns None when the version no longer matches."""
    stmt = (
        update(Item)
        .where(Item.id == item_id, Item.version == expected_version)
        .values(**values, version=Item.version + 1, updated_at=utcnow())
    )
    result: CursorResult[Any] = session.execute(stmt)  # type: ignore[assignment]
    if result.rowcount == 0:
        return None
    session.flush()
    session.expire_all()
    return get_item(session, item_id)


def mark_deleted(session: Session, item: Item) -> Item:
    """Move an item to the recycle bin."""
    item.deleted_at = utcnow()
    item.status = "trashed"
    item.version += 1
    item.updated_at = utcnow()
    session.flush()
    return item


def mark_restored(session: Session, item: Item) -> Item:
    """Restore an item from the recycle bin."""
    item.deleted_at = None
    item.status = "active"
    item.version += 1
    item.updated_at = utcnow()
    session.flush()
    return item


def replace_tags(session: Session, item: Item, tags: list[Tag]) -> None:
    """Replace every tag association of an item."""
    item.tags = tags
    session.flush()


def ensure_tags(session: Session, names: list[str]) -> list[Tag]:
    """Return tags by name, creating the missing ones (trimmed, de-duplicated)."""
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in names:
        name = raw.strip()
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(name)
    if not cleaned:
        return []

    existing = {
        tag.name: tag for tag in session.scalars(select(Tag).where(Tag.name.in_(cleaned))).all()
    }
    result: list[Tag] = []
    for name in cleaned:
        tag = existing.get(name)
        if tag is None:
            tag = Tag(name=name)
            session.add(tag)
            try:
                session.flush()
            except IntegrityError:
                session.rollback()
                tag = session.scalars(select(Tag).where(Tag.name == name)).one()
            else:
                existing[name] = tag
        result.append(tag)
    return result


def tag_ids_of(session: Session, item_id: str) -> list[str]:
    """Return tag ids attached to an item."""
    return list(session.scalars(select(ItemTag.tag_id).where(ItemTag.item_id == item_id)).all())
