"""Keyword search over the FTS5 mirror table (B6-2)."""

from __future__ import annotations

import re

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..db.models import Item, ItemTag

MIN_FTS_TERM_LENGTH = 3
_SNIPPET_RADIUS = 100


def split_terms(query: str) -> list[str]:
    """Split the raw query into searchable terms."""
    return [term for term in re.split(r"\s+", query.strip()) if term]


def fts_query(terms: list[str]) -> str:
    """Build a MATCH expression: quoted phrases OR-ed together."""
    return " OR ".join(f'"{term}"' for term in terms)


def filtered_ids(
    session: Session, types: list[str] | None, tag_ids: list[str] | None
) -> set[str] | None:
    """Resolve id filters with SQL so both keyword and semantic paths reuse them."""
    if not types and not tag_ids:
        return None
    stmt = select(Item.id).where(Item.deleted_at.is_(None), Item.status == "active")
    if types:
        stmt = stmt.where(Item.type.in_(types))
    if tag_ids:
        stmt = stmt.where(Item.id.in_(select(ItemTag.item_id).where(ItemTag.tag_id.in_(tag_ids))))
    return set(session.scalars(stmt).all())


def keyword_search(
    session: Session,
    terms: list[str],
    *,
    limit: int,
    types: list[str] | None = None,
    tag_ids: list[str] | None = None,
) -> list[tuple[Item, float]]:
    """Return (item, score) pairs ordered by relevance; score normalised to 0-1."""
    if not terms:
        return []
    allowed = filtered_ids(session, types, tag_ids)
    if allowed is not None and not allowed:
        return []

    long_terms = [term for term in terms if len(term) >= MIN_FTS_TERM_LENGTH]
    if long_terms:
        rows = _fts_rows(session, long_terms, limit=max(limit, 1) * 3)
    else:
        rows = _like_rows(session, terms, limit=max(limit, 1) * 3)

    items: list[tuple[Item, float]] = []
    for item, raw_score in rows:
        if allowed is not None and item.id not in allowed:
            continue
        items.append((item, raw_score))
    if not items:
        return []
    top = max(score for _item, score in items) or 1.0
    return [(item, min(score / top, 1.0)) for item, score in items][:limit]


def _fts_rows(session: Session, terms: list[str], *, limit: int) -> list[tuple[Item, float]]:
    try:
        match_expression = fts_query(terms)
        stmt = text(
            """
            SELECT items.id AS item_id, bm25(items_fts) AS rank
            FROM items_fts
            JOIN items ON items.rowid = items_fts.rowid
            WHERE items_fts MATCH :match
              AND items.deleted_at IS NULL
              AND items.status = 'active'
            ORDER BY rank
            LIMIT :limit
            """
        )
        result = session.execute(stmt, {"match": match_expression, "limit": limit}).all()
    except Exception:  # pragma: no cover - FTS 表缺失时退化为 LIKE
        return _like_rows(session, terms, limit=limit)

    ids = [row[0] for row in result]
    ranks = {row[0]: float(row[1]) for row in result}
    loaded = (
        {item.id: item for item in session.scalars(select(Item).where(Item.id.in_(ids))).all()}
        if ids
        else {}
    )
    return [
        (loaded[item_id], 1.0 / (1.0 + abs(ranks[item_id]))) for item_id in ids if item_id in loaded
    ]


def _like_rows(session: Session, terms: list[str], *, limit: int) -> list[tuple[Item, float]]:
    """Fallback for short CJK queries: score by term occurrences in title/content."""
    scores = []
    for term in terms:
        width = max(len(term), 1)
        title = func.coalesce(Item.title, "")
        content = func.coalesce(Item.content, "")
        title_hits = (func.length(title) - func.length(func.replace(title, term, ""))) * 1.0
        content_hits = (func.length(content) - func.length(func.replace(content, term, ""))) * 1.0
        scores.append(title_hits * 3.0 / width + content_hits / width)
    total = scores[0]
    for extra in scores[1:]:
        total = total + extra
    stmt = (
        select(Item, total.label("score"))
        .where(
            Item.deleted_at.is_(None),
            Item.status == "active",
            total > 0,
        )
        .order_by(total.desc(), Item.id.desc())
        .limit(limit)
    )
    return [(row[0], float(row[1] or 0)) for row in session.execute(stmt).all()]


def build_snippet(item: Item, terms: list[str], *, length: int = 200) -> str:
    """Return a plain-text window around the first matched term."""
    body = (item.content or "").strip() or item.title
    body = re.sub(r"\s+", " ", body)
    lowered = body.lower()
    position = -1
    for term in terms:
        found = lowered.find(term.lower())
        if found != -1 and (position == -1 or found < position):
            position = found
    if position == -1:
        return body[:length]
    start = max(position - _SNIPPET_RADIUS, 0)
    end = min(start + length, len(body))
    snippet = body[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(body):
        snippet = snippet + "..."
    return snippet
