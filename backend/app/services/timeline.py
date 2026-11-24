"""Timeline grouping and cursor paging (§9.2)."""

from __future__ import annotations

import base64
import binascii
import json
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from ..core.errors import unsupported_query
from ..db.models import Item
from ..repositories import items as repo
from ..schemas.timeline import TimelineGroup, TimelineOut
from .items import to_item_out

GROUP_BY_VALUES = ("day", "week", "month")
DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def _parse_timestamp(value: str | None, field: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise unsupported_query(f"{field} 不是合法的 ISO 8601 时间") from exc
    return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _resolve_zone(tz: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise unsupported_query(f"非法时区：{tz}") from exc


def _encode_cursor(item: Item) -> str:
    payload = {
        "created_at": item.created_at.astimezone(UTC).isoformat(),
        "id": item.id,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def _decode_cursor(value: str) -> tuple[datetime, str]:
    try:
        padding = "=" * (-len(value) % 4)
        raw = base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii")).decode("utf-8")
        payload = json.loads(raw)
        created_at = datetime.fromisoformat(str(payload["created_at"]))
        item_id = str(payload["id"])
    except (ValueError, TypeError, KeyError, binascii.Error, UnicodeError) as exc:
        raise unsupported_query("cursor 非法") from exc
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    else:
        created_at = created_at.astimezone(UTC)
    return created_at, item_id


def _group_key(local_date: date, group_by: str) -> tuple[str, str]:
    if group_by == "day":
        key = local_date.isoformat()
        return key, key
    if group_by == "week":
        iso_year, iso_week, _ = local_date.isocalendar()
        return f"{iso_year}-W{iso_week:02d}", f"{iso_year} 第{iso_week}周"
    return f"{local_date.year:04d}-{local_date.month:02d}", (
        f"{local_date.year}年{local_date.month}月"
    )


def _build_groups(items: list[Item], *, group_by: str, zone: ZoneInfo) -> list[TimelineGroup]:
    grouped: dict[str, TimelineGroup] = {}
    order: list[str] = []
    for item in items:
        local_date = item.created_at.astimezone(zone).date()
        key, label = _group_key(local_date, group_by)
        group = grouped.get(key)
        if group is None:
            group = TimelineGroup(key=key, label=label, item_count=0)
            grouped[key] = group
            order.append(key)
        group.items.append(to_item_out(item))
        group.item_count += 1
    return [grouped[key] for key in order]


VALID_TYPES = ("note", "tex", "file")
VALID_STATUSES = ("active", "archived", "trashed")


def _validate_filters(*, types: list[str] | None, status: str | None, q: str | None) -> str:
    if types and not set(types) <= set(VALID_TYPES):
        raise unsupported_query("type 只支持 note、tex、file")
    resolved_status = status or "active"
    if resolved_status not in VALID_STATUSES:
        raise unsupported_query("status 只支持 active、archived、trashed")
    if q is not None and len(q) > 200:
        raise unsupported_query("q 过长")
    return resolved_status


def get_timeline(
    session: Session,
    *,
    created_from: str | None = None,
    created_to: str | None = None,
    group_by: str = "day",
    tz: str = "UTC",
    cursor: str | None = None,
    limit: int = DEFAULT_LIMIT,
    types: list[str] | None = None,
    status: str | None = None,
    tag_ids: list[str] | None = None,
    q: str | None = None,
) -> TimelineOut:
    """Return a grouped page of items ordered by ``created_at DESC, id DESC``.

    Filters mirror ``GET /items``; ``status`` defaults to ``active`` so the
    timeline never mixes archived or recycled entries by accident.
    """
    if group_by not in GROUP_BY_VALUES:
        raise unsupported_query("group_by 只支持 day、week、month")
    if not 1 <= limit <= MAX_LIMIT:
        raise unsupported_query(f"limit 必须在 1 到 {MAX_LIMIT} 之间")
    zone = _resolve_zone(tz)
    resolved_status = _validate_filters(types=types, status=status, q=q)

    start = _parse_timestamp(created_from, "from")
    end = _parse_timestamp(created_to, "to")
    if start is not None and end is not None and start > end:
        raise unsupported_query("时间区间非法：from 晚于 to")

    before_created_at: datetime | None = None
    before_id: str | None = None
    if cursor:
        before_created_at, before_id = _decode_cursor(cursor)

    filters = repo.ItemFilters(
        types=tuple(types or ()),
        tag_ids=tuple(tag_ids or ()),
        status=resolved_status,
        q=q,
        created_from=start,
        created_to=end,
    )
    rows = repo.list_timeline_items(
        session,
        filters=filters,
        before_created_at=before_created_at,
        before_id=before_id,
        limit=limit + 1,
    )
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = _encode_cursor(page[-1]) if has_more and page else None
    return TimelineOut(
        groups=_build_groups(page, group_by=group_by, zone=zone),
        next_cursor=next_cursor,
        has_more=has_more,
    )
