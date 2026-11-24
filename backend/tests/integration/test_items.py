"""Item CRUD, content I/O, recycle bin, pagination and idempotency (§9.2)."""

from __future__ import annotations

from typing import Any

from app.db.base import utcnow
from app.db.models import FileAsset, Item, Tag
from fastapi.testclient import TestClient


def create_item(
    client: TestClient,
    auth_headers: dict[str, str],
    **overrides: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type": "note",
        "title": "向量检索笔记",
        "content": "# 标题\n混合检索用 RRF",
        "tags": ["机器学习"],
    }
    payload.update(overrides)
    response = client.post("/api/v1/items", json=payload, headers=auth_headers)
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_create_note_returns_envelope_item(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    data = create_item(client, auth_headers)
    assert data["type"] == "note"
    assert data["status"] == "active"
    assert data["version"] == 1
    assert data["embedding_status"] == "pending"
    assert data["preview"].startswith("标题")
    assert [tag["name"] for tag in data["tags"]] == ["机器学习"]
    assert data["tags"][0]["id"]
    assert data["deleted_at"] is None
    assert data["idempotent_replay"] is False


def test_create_requires_content_for_note(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/v1/items",
        json={"type": "note", "title": "缺正文"},
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert response.json()["code"] == 40001


def test_create_file_item_requires_existing_asset(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(
        "/api/v1/items",
        json={"type": "file", "title": "论文.pdf", "file_asset_id": "0199aaaaaaaaaaaaaaaaaaaaaaaa"},
        headers=auth_headers,
    )
    assert response.status_code == 404
    assert response.json()["code"] == 30001


def test_create_rejects_empty_title(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/v1/items",
        json={"type": "note", "title": "", "content": "x"},
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert response.json()["code"] == 40001


def test_get_item_and_not_found(client: TestClient, auth_headers: dict[str, str]) -> None:
    data = create_item(client, auth_headers)
    fetched = client.get(f"/api/v1/items/{data['id']}", headers=auth_headers)
    assert fetched.status_code == 200
    assert fetched.json()["data"]["id"] == data["id"]

    missing = client.get("/api/v1/items/0199bbbbbbbbbbbbbbbbbbbbbbbbbbbb", headers=auth_headers)
    assert missing.status_code == 404
    assert missing.json()["code"] == 30001


def test_requires_token(client: TestClient) -> None:
    assert client.get("/api/v1/items").status_code == 401
    assert client.post("/api/v1/items", json={"type": "note", "title": "x"}).status_code == 401


def test_patch_updates_title_and_version(client: TestClient, auth_headers: dict[str, str]) -> None:
    data = create_item(client, auth_headers)
    response = client.patch(
        f"/api/v1/items/{data['id']}",
        json={"title": "改过的标题", "expected_version": data["version"], "tags": ["检索", "AI"]},
        headers=auth_headers,
    )
    assert response.status_code == 200
    updated = response.json()["data"]
    assert updated["title"] == "改过的标题"
    assert updated["version"] == data["version"] + 1
    assert {tag["name"] for tag in updated["tags"]} == {"检索", "AI"}


def test_patch_without_version_is_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    data = create_item(client, auth_headers)
    response = client.patch(
        f"/api/v1/items/{data['id']}", json={"title": "无版本"}, headers=auth_headers
    )
    assert response.status_code == 422
    assert response.json()["code"] == 40001


def test_patch_version_conflict_returns_current_item(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    data = create_item(client, auth_headers)
    client.patch(
        f"/api/v1/items/{data['id']}",
        json={"title": "第一次", "expected_version": 1},
        headers=auth_headers,
    )
    conflict = client.patch(
        f"/api/v1/items/{data['id']}",
        json={"title": "第二次", "expected_version": 1},
        headers=auth_headers,
    )
    body = conflict.json()
    assert conflict.status_code == 409
    assert body["code"] == 30003
    assert body["data"]["version"] == 2
    assert body["data"]["title"] == "第一次"


def test_delete_moves_to_recycle_bin_and_restore(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    data = create_item(client, auth_headers)
    deleted = client.delete(f"/api/v1/items/{data['id']}", headers=auth_headers)
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"id": data["id"]}

    listed = client.get("/api/v1/items", headers=auth_headers).json()["data"]
    assert all(row["id"] != data["id"] for row in listed["items"])

    trashed = client.get(
        "/api/v1/items", params={"status": "trashed"}, headers=auth_headers
    ).json()["data"]
    assert [row["id"] for row in trashed["items"]] == [data["id"]]

    restored = client.post(f"/api/v1/items/{data['id']}/restore", headers=auth_headers)
    assert restored.status_code == 200
    assert restored.json()["data"]["status"] == "active"
    assert restored.json()["data"]["deleted_at"] is None

    again = client.post(f"/api/v1/items/{data['id']}/restore", headers=auth_headers)
    assert again.status_code == 422
    assert again.json()["code"] == 40001


def test_content_roundtrip_with_version(client: TestClient, auth_headers: dict[str, str]) -> None:
    data = create_item(client, auth_headers)

    read = client.get(f"/api/v1/items/{data['id']}/content", headers=auth_headers)
    assert read.status_code == 200
    assert read.headers["content-type"].startswith("text/plain")
    assert read.text == "# 标题\n混合检索用 RRF"

    written = client.put(
        f"/api/v1/items/{data['id']}/content",
        params={"expected_version": data["version"]},
        content="# 新内容\n第二轮",
        headers={**auth_headers, "Content-Type": "text/plain; charset=utf-8"},
    )
    assert written.status_code == 200
    body = written.json()["data"]
    assert body["version"] == data["version"] + 1
    assert body["preview"].startswith("新内容")
    assert body["embedding_status"] == "pending"

    conflict = client.put(
        f"/api/v1/items/{data['id']}/content",
        params={"expected_version": data["version"]},
        content="过期写入",
        headers={**auth_headers, "Content-Type": "text/plain; charset=utf-8"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == 30003
    assert conflict.json()["data"]["content"] == "# 新内容\n第二轮"


def test_content_rejects_file_items(client: TestClient, auth_headers: dict[str, str]) -> None:
    factory = client.app.state.session_factory
    with factory() as session:
        item = Item(type="file", title="论文.pdf", version=1, status="active")
        session.add(item)
        session.flush()
        session.add(
            FileAsset(
                item_id=item.id,
                original_name="论文.pdf",
                mime_type="application/pdf",
                size_bytes=1024,
                sha256="a" * 64,
                relative_path="2026/11/x/论文.pdf",
            )
        )
        session.commit()
        item_id = item.id

    response = client.get(f"/api/v1/items/{item_id}/content", headers=auth_headers)
    assert response.status_code == 422
    assert response.json()["code"] == 40001


def test_pagination_boundaries(client: TestClient, auth_headers: dict[str, str]) -> None:
    for index in range(5):
        create_item(client, auth_headers, title=f"条目 {index}")

    first = client.get(
        "/api/v1/items", params={"page": 1, "page_size": 2}, headers=auth_headers
    ).json()["data"]
    assert len(first["items"]) == 2
    assert first["total"] == 5
    assert first["has_more"] is True

    last = client.get(
        "/api/v1/items", params={"page": 3, "page_size": 2}, headers=auth_headers
    ).json()["data"]
    assert len(last["items"]) == 1
    assert last["has_more"] is False

    oversized = client.get("/api/v1/items", params={"page_size": 101}, headers=auth_headers)
    assert oversized.status_code == 400
    assert oversized.json()["code"] == 40002

    bad_sort = client.get("/api/v1/items", params={"sort": "content"}, headers=auth_headers)
    assert bad_sort.status_code == 400
    assert bad_sort.json()["code"] == 40002

    bad_date = client.get("/api/v1/items", params={"created_from": "昨天"}, headers=auth_headers)
    assert bad_date.status_code == 400
    assert bad_date.json()["code"] == 40002


def test_filters_by_type_tag_and_query(client: TestClient, auth_headers: dict[str, str]) -> None:
    note = create_item(client, auth_headers, title="Markdown 笔记", tags=["检索"])
    create_item(client, auth_headers, type="tex", title="TeX 便签", content="$x^2$", tags=["数学"])

    by_type = client.get("/api/v1/items", params={"type": "tex"}, headers=auth_headers).json()[
        "data"
    ]
    assert [row["type"] for row in by_type["items"]] == ["tex"]

    tag_id = note["tags"][0]["id"]
    by_tag = client.get("/api/v1/items", params={"tag_id": tag_id}, headers=auth_headers).json()[
        "data"
    ]
    assert [row["id"] for row in by_tag["items"]] == [note["id"]]

    by_query = client.get("/api/v1/items", params={"q": "Markdown"}, headers=auth_headers).json()[
        "data"
    ]
    assert [row["id"] for row in by_query["items"]] == [note["id"]]


def test_idempotency_replays_first_result(client: TestClient, auth_headers: dict[str, str]) -> None:
    payload = {"type": "note", "title": "幂等创建", "content": "只应创建一次"}
    headers = {**auth_headers, "Idempotency-Key": "test-key-0001"}

    first = client.post("/api/v1/items", json=payload, headers=headers)
    second = client.post("/api/v1/items", json=payload, headers=headers)
    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["data"]["id"] == first.json()["data"]["id"]
    assert second.json()["data"]["idempotent_replay"] is True

    listed = client.get("/api/v1/items", headers=auth_headers).json()["data"]
    assert listed["total"] == 1

    different = client.post(
        "/api/v1/items",
        json={**payload, "title": "换了内容"},
        headers=headers,
    )
    assert different.status_code == 409
    assert different.json()["code"] == 30002


def test_delete_is_idempotent(client: TestClient, auth_headers: dict[str, str]) -> None:
    data = create_item(client, auth_headers)
    assert client.delete(f"/api/v1/items/{data['id']}", headers=auth_headers).status_code == 200
    second = client.delete(f"/api/v1/items/{data['id']}", headers=auth_headers)
    assert second.status_code == 200
    assert second.json()["data"] == {"id": data["id"]}


def test_tag_delete_cascades_item_tags(client: TestClient, auth_headers: dict[str, str]) -> None:
    data = create_item(client, auth_headers, tags=["待删标签"])
    factory = client.app.state.session_factory
    with factory() as session:
        tag = session.query(Tag).filter(Tag.name == "待删标签").one()
        session.delete(tag)
        session.commit()

    fetched = client.get(f"/api/v1/items/{data['id']}", headers=auth_headers).json()["data"]
    assert fetched["tags"] == []


def test_preview_updates_on_content_save(client: TestClient, auth_headers: dict[str, str]) -> None:
    data = create_item(client, auth_headers, content="一" * 300)
    assert len(data["preview"]) == 200

    written = client.put(
        f"/api/v1/items/{data['id']}/content",
        params={"expected_version": data["version"]},
        content="短内容",
        headers={**auth_headers, "Content-Type": "text/plain"},
    )
    assert written.json()["data"]["preview"] == "短内容"
    assert written.json()["data"]["updated_at"] >= data["updated_at"]
    assert utcnow().year == 2026
