"""Timeline grouping, timezone boundaries, validation and cursor paging (§9.2)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.db.models import Item
from fastapi.testclient import TestClient


def seed_item(
    client: TestClient,
    *,
    title: str,
    created_at: datetime,
    status: str = "active",
    deleted_at: datetime | None = None,
) -> str:
    factory = client.app.state.session_factory
    with factory() as session:
        item = Item(
            type="note",
            title=title,
            content="正文",
            preview="正文",
            status=status,
            version=1,
            embedding_status="pending",
            created_at=created_at,
            updated_at=created_at,
            deleted_at=deleted_at,
        )
        session.add(item)
        session.commit()
        return item.id


def timeline(client: TestClient, auth_headers: dict[str, str], **params: object) -> dict:
    response = client.get("/api/v1/timeline", params=params, headers=auth_headers)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def titles_of(data: dict) -> list[list[str]]:
    return [[item["title"] for item in group["items"]] for group in data["groups"]]


def test_empty_timeline(client: TestClient, auth_headers: dict[str, str]) -> None:
    data = timeline(client, auth_headers)
    assert data == {"groups": [], "next_cursor": None, "has_more": False}


def test_timeline_only_returns_active_items(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
    seed_item(client, title="active", created_at=now)
    seed_item(client, title="archived", created_at=now, status="archived")
    seed_item(client, title="trashed", created_at=now, status="trashed")
    seed_item(client, title="soft-deleted", created_at=now, deleted_at=now)

    data = timeline(client, auth_headers)
    assert titles_of(data) == [["active"]]


def test_day_week_month_boundaries_in_shanghai(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    # Asia/Shanghai is UTC+08:00, so 16:00Z is local midnight.
    t1 = datetime(2025, 12, 31, 15, 59, 59, tzinfo=UTC)
    t2 = datetime(2025, 12, 31, 16, 0, 0, tzinfo=UTC)
    t3 = datetime(2026, 1, 4, 15, 59, 59, tzinfo=UTC)
    t4 = datetime(2026, 1, 4, 16, 0, 0, tzinfo=UTC)
    for index, moment in enumerate((t1, t2, t3, t4), start=1):
        seed_item(client, title=f"item-{index}", created_at=moment)

    by_day = timeline(client, auth_headers, tz="Asia/Shanghai", group_by="day")
    assert [group["key"] for group in by_day["groups"]] == [
        "2026-01-05",
        "2026-01-04",
        "2026-01-01",
        "2025-12-31",
    ]
    assert all(group["item_count"] == 1 for group in by_day["groups"])

    by_week = timeline(client, auth_headers, tz="Asia/Shanghai", group_by="week")
    assert [group["key"] for group in by_week["groups"]] == ["2026-W02", "2026-W01"]
    assert [group["item_count"] for group in by_week["groups"]] == [1, 3]
    # 2025-12-31 (local) already belongs to ISO week 2026-W01: cross-year boundary.
    assert by_week["groups"][-1]["label"] == "2026 第1周"

    by_month = timeline(client, auth_headers, tz="Asia/Shanghai", group_by="month")
    assert [group["key"] for group in by_month["groups"]] == ["2026-01", "2025-12"]
    assert [group["item_count"] for group in by_month["groups"]] == [3, 1]


def test_from_to_are_inclusive(client: TestClient, auth_headers: dict[str, str]) -> None:
    base = datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)
    for hour in range(5):
        seed_item(
            client,
            title=f"h{hour}",
            created_at=base + timedelta(hours=hour),
        )

    data = timeline(
        client,
        auth_headers,
        **{"from": "2026-01-01T01:00:00Z", "to": "2026-01-01T03:00:00Z"},
    )
    assert titles_of(data) == [["h3", "h2", "h1"]]
    assert data["groups"][0]["key"] == "2026-01-01"


def test_cursor_paging_is_stable(client: TestClient, auth_headers: dict[str, str]) -> None:
    base = datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)
    for hour in range(5):
        seed_item(
            client,
            title=f"h{hour}",
            created_at=base + timedelta(hours=hour),
        )

    first = timeline(client, auth_headers, limit=2)
    assert titles_of(first) == [["h4", "h3"]]
    assert first["has_more"] is True
    assert first["next_cursor"]
    assert first["groups"][0]["item_count"] == 2

    second = timeline(client, auth_headers, limit=2, cursor=first["next_cursor"])
    assert titles_of(second) == [["h2", "h1"]]
    assert second["has_more"] is True

    third = timeline(client, auth_headers, limit=2, cursor=second["next_cursor"])
    assert titles_of(third) == [["h0"]]
    assert third["has_more"] is False
    assert third["next_cursor"] is None

    seen = [
        item["id"]
        for page in (first, second, third)
        for group in page["groups"]
        for item in group["items"]
    ]
    assert len(seen) == len(set(seen)) == 5


def test_timeline_ties_break_by_id_desc(client: TestClient, auth_headers: dict[str, str]) -> None:
    moment = datetime(2026, 1, 1, 8, 0, 0, tzinfo=UTC)
    first_id = seed_item(client, title="first", created_at=moment)
    second_id = seed_item(client, title="second", created_at=moment)
    data = timeline(client, auth_headers)
    ids = [item["id"] for group in data["groups"] for item in group["items"]]
    assert ids == sorted([first_id, second_id], reverse=True)


def test_invalid_timeline_parameters(client: TestClient, auth_headers: dict[str, str]) -> None:
    cases = [
        {"tz": "Mars/Olympus"},
        {"group_by": "year"},
        {"limit": 0},
        {"limit": 201},
        {"from": "昨天"},
        {"from": "2026-01-02T00:00:00Z", "to": "2026-01-01T00:00:00Z"},
        {"cursor": "!!!not-base64!!!"},
    ]
    for params in cases:
        response = client.get("/api/v1/timeline", params=params, headers=auth_headers)
        assert response.status_code == 400, params
        assert response.json()["code"] == 40002, params


def _create_via_api(
    client: TestClient,
    auth_headers: dict[str, str],
    *,
    title: str,
    item_type: str = "note",
    content: str = "正文",
    tags: list[str] | None = None,
) -> dict:
    response = client.post(
        "/api/v1/items",
        json={"type": item_type, "title": title, "content": content, "tags": tags or []},
        headers=auth_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_timeline_filters_mirror_items_list(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    note = _create_via_api(client, auth_headers, title="Markdown 笔记", tags=["检索"])
    tex = _create_via_api(client, auth_headers, title="TeX 便签", item_type="tex", content="$x^2$")

    by_type = timeline(client, auth_headers, type="tex")
    assert [item["title"] for group in by_type["groups"] for item in group["items"]] == [
        tex["title"]
    ]

    tag_id = note["tags"][0]["id"]
    by_tag = timeline(client, auth_headers, tag_id=tag_id)
    assert [item["title"] for group in by_tag["groups"] for item in group["items"]] == [
        note["title"]
    ]

    by_query = timeline(client, auth_headers, q="Markdown")
    assert [item["title"] for group in by_query["groups"] for item in group["items"]] == [
        note["title"]
    ]


def test_timeline_status_defaults_to_active(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    keep = _create_via_api(client, auth_headers, title="保留")
    archived = _create_via_api(client, auth_headers, title="归档")
    client.patch(
        f"/api/v1/items/{archived['id']}",
        json={"status": "archived", "expected_version": archived["version"]},
        headers=auth_headers,
    )

    default_titles = [
        item["title"]
        for group in timeline(client, auth_headers)["groups"]
        for item in group["items"]
    ]
    assert default_titles == [keep["title"]]

    archived_titles = [
        item["title"]
        for group in timeline(client, auth_headers, status="archived")["groups"]
        for item in group["items"]
    ]
    assert archived_titles == [archived["title"]]


def test_timeline_rejects_invalid_filters(client: TestClient, auth_headers: dict[str, str]) -> None:
    for params in (
        {"type": "spreadsheet"},
        {"status": "bogus"},
        {"group_by": "year"},
        {"tz": "Not/AZone"},
        {"limit": 0},
        {"limit": 500},
        {"cursor": "not-a-cursor"},
    ):
        response = client.get("/api/v1/timeline", params=params, headers=auth_headers)
        assert response.status_code == 400, (params, response.text)
        assert response.json()["code"] == 40002
