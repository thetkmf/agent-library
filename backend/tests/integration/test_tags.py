"""Tag CRUD, item_count, associations and the B2 tag fixes (§9.3)."""

from __future__ import annotations

from typing import Any

from app.db.models import Item, Tag
from fastapi.testclient import TestClient


def create_item(
    client: TestClient,
    auth_headers: dict[str, str],
    **overrides: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type": "note",
        "title": "带标签的条目",
        "content": "正文",
        "tags": [],
    }
    payload.update(overrides)
    response = client.post("/api/v1/items", json=payload, headers=auth_headers)
    assert response.status_code == 201, response.text
    return response.json()["data"]


def create_tag(client: TestClient, auth_headers: dict[str, str], name: str) -> dict[str, Any]:
    response = client.post("/api/v1/tags", json={"name": name}, headers=auth_headers)
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_tag_crud_and_list_order(client: TestClient, auth_headers: dict[str, str]) -> None:
    for name in ("beta", "alpha", "gamma"):
        create_tag(client, auth_headers, name)

    listed = client.get("/api/v1/tags", headers=auth_headers)
    assert listed.status_code == 200
    assert [tag["name"] for tag in listed.json()["data"]] == ["alpha", "beta", "gamma"]
    assert all(tag["item_count"] == 0 for tag in listed.json()["data"])

    renamed = client.patch(
        f"/api/v1/tags/{listed.json()['data'][0]['id']}",
        json={"name": "delta"},
        headers=auth_headers,
    )
    assert renamed.status_code == 200
    assert renamed.json()["data"]["name"] == "delta"

    deleted = client.delete(f"/api/v1/tags/{listed.json()['data'][0]['id']}", headers=auth_headers)
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"id": listed.json()["data"][0]["id"]}
    remaining = client.get("/api/v1/tags", headers=auth_headers).json()["data"]
    assert {tag["name"] for tag in remaining} == {"beta", "gamma"}


def test_tag_name_is_trimmed_and_casefold_unique(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    created = create_tag(client, auth_headers, "  Machine  ")
    assert created["name"] == "Machine"

    duplicate = client.post("/api/v1/tags", json={"name": "machine"}, headers=auth_headers)
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == 30002

    duplicate_trimmed = client.post(
        "/api/v1/tags", json={"name": " machine "}, headers=auth_headers
    )
    assert duplicate_trimmed.status_code == 409
    assert duplicate_trimmed.json()["code"] == 30002


def test_tag_name_length_validation(client: TestClient, auth_headers: dict[str, str]) -> None:
    too_long = "x" * 51
    response = client.post("/api/v1/tags", json={"name": too_long}, headers=auth_headers)
    assert response.status_code == 422
    assert response.json()["code"] == 40001

    blank = client.post("/api/v1/tags", json={"name": "   "}, headers=auth_headers)
    assert blank.status_code == 422
    assert blank.json()["code"] == 40001

    created = create_tag(client, auth_headers, "短标签")
    renamed = client.patch(
        f"/api/v1/tags/{created['id']}", json={"name": too_long}, headers=auth_headers
    )
    assert renamed.status_code == 422
    assert renamed.json()["code"] == 40001


def test_tag_rename_duplicate_is_conflict(client: TestClient, auth_headers: dict[str, str]) -> None:
    first = create_tag(client, auth_headers, "Alpha")
    second = create_tag(client, auth_headers, "Beta")
    conflict = client.patch(
        f"/api/v1/tags/{second['id']}", json={"name": "alpha"}, headers=auth_headers
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == 30002

    same = client.patch(f"/api/v1/tags/{first['id']}", json={"name": "Alpha"}, headers=auth_headers)
    assert same.status_code == 200


def test_tag_missing_returns_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    missing = "0199cccccccccccccccccccccccccccc"
    renamed = client.patch(f"/api/v1/tags/{missing}", json={"name": "x"}, headers=auth_headers)
    assert renamed.status_code == 404
    assert renamed.json()["code"] == 30001
    deleted = client.delete(f"/api/v1/tags/{missing}", headers=auth_headers)
    assert deleted.status_code == 404
    assert deleted.json()["code"] == 30001


def test_item_count_only_counts_active_non_deleted_items(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    active = create_item(client, auth_headers, tags=["计数"])
    archived = create_item(client, auth_headers, tags=["计数"])
    recycled = create_item(client, auth_headers, tags=["计数"])
    patched_trash = create_item(client, auth_headers, tags=["计数"])

    assert (
        client.patch(
            f"/api/v1/items/{archived['id']}",
            json={"status": "archived", "expected_version": archived["version"]},
            headers=auth_headers,
        ).status_code
        == 200
    )
    assert client.delete(f"/api/v1/items/{recycled['id']}", headers=auth_headers).status_code == 200
    assert (
        client.patch(
            f"/api/v1/items/{patched_trash['id']}",
            json={"status": "trashed", "expected_version": patched_trash["version"]},
            headers=auth_headers,
        ).status_code
        == 200
    )

    tags = client.get("/api/v1/tags", headers=auth_headers).json()["data"]
    assert len(tags) == 1
    assert tags[0]["item_count"] == 1
    assert active["id"]


def test_delete_tag_unbinds_without_deleting_items(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    item = create_item(client, auth_headers, tags=["待删标签"])
    tag_id = item["tags"][0]["id"]

    deleting = client.delete(f"/api/v1/tags/{tag_id}", headers=auth_headers)
    assert deleting.status_code == 200

    fetched = client.get(f"/api/v1/items/{item['id']}", headers=auth_headers)
    assert fetched.status_code == 200
    assert fetched.json()["data"]["tags"] == []
    assert fetched.json()["data"]["status"] == "active"

    factory = client.app.state.session_factory
    with factory() as session:
        assert session.query(Tag).filter(Tag.id == tag_id).first() is None
        item_row = session.get(Item, item["id"])
        assert item_row is not None


def test_attach_tags_is_bulk_and_idempotent(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    item = create_item(client, auth_headers)
    first = create_tag(client, auth_headers, "数学")
    second = create_tag(client, auth_headers, "检索")

    attached = client.post(
        f"/api/v1/items/{item['id']}/tags",
        json={"tag_ids": [first["id"], second["id"], first["id"]]},
        headers=auth_headers,
    )
    assert attached.status_code == 200, attached.text
    body = attached.json()["data"]
    assert {tag["name"] for tag in body["tags"]} == {"数学", "检索"}
    assert body["version"] == item["version"] + 1

    repeated = client.post(
        f"/api/v1/items/{item['id']}/tags",
        json={"tag_ids": [first["id"], second["id"]]},
        headers=auth_headers,
    )
    assert repeated.status_code == 200
    assert repeated.json()["data"]["version"] == body["version"]

    empty = client.post(
        f"/api/v1/items/{item['id']}/tags", json={"tag_ids": []}, headers=auth_headers
    )
    assert empty.status_code == 200
    assert empty.json()["data"]["version"] == body["version"]


def test_attach_and_detach_error_paths(client: TestClient, auth_headers: dict[str, str]) -> None:
    item = create_item(client, auth_headers)
    tag = create_tag(client, auth_headers, "可解除")
    other = create_tag(client, auth_headers, "未关联")
    missing_item = "0199dddddddddddddddddddddddddd"

    attach_missing_item = client.post(
        f"/api/v1/items/{missing_item}/tags",
        json={"tag_ids": [tag["id"]]},
        headers=auth_headers,
    )
    assert attach_missing_item.status_code == 404
    assert attach_missing_item.json()["code"] == 30001

    unknown_tag = "0199eeeeeeeeeeeeeeeeeeeeeeeeeeee"
    attach_unknown = client.post(
        f"/api/v1/items/{item['id']}/tags",
        json={"tag_ids": [unknown_tag]},
        headers=auth_headers,
    )
    assert attach_unknown.status_code == 404
    assert attach_unknown.json()["code"] == 30001

    client.post(
        f"/api/v1/items/{item['id']}/tags",
        json={"tag_ids": [tag["id"]]},
        headers=auth_headers,
    )
    detached = client.delete(f"/api/v1/items/{item['id']}/tags/{tag['id']}", headers=auth_headers)
    assert detached.status_code == 200
    assert detached.json()["data"]["tags"] == []

    detach_again = client.delete(
        f"/api/v1/items/{item['id']}/tags/{tag['id']}", headers=auth_headers
    )
    assert detach_again.status_code == 404
    assert detach_again.json()["code"] == 30001

    detach_unlinked = client.delete(
        f"/api/v1/items/{item['id']}/tags/{other['id']}", headers=auth_headers
    )
    assert detach_unlinked.status_code == 404
    assert detach_unlinked.json()["code"] == 30001


def test_tag_only_patch_bumps_version(client: TestClient, auth_headers: dict[str, str]) -> None:
    item = create_item(client, auth_headers)
    tag = create_tag(client, auth_headers, "仅改标签")

    patched = client.patch(
        f"/api/v1/items/{item['id']}",
        json={"tags": [tag["name"]], "expected_version": item["version"]},
        headers=auth_headers,
    )
    assert patched.status_code == 200, patched.text
    updated = patched.json()["data"]
    assert updated["version"] == item["version"] + 1
    assert [tag["name"] for tag in updated["tags"]] == ["仅改标签"]

    stale_save = client.put(
        f"/api/v1/items/{item['id']}/content",
        params={"expected_version": item["version"]},
        content="用旧版本保存",
        headers={**auth_headers, "Content-Type": "text/plain"},
    )
    assert stale_save.status_code == 409
    assert stale_save.json()["code"] == 30003


def test_multiple_tag_filter_is_deduplicated(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    first_tag = create_tag(client, auth_headers, "Alpha")
    second_tag = create_tag(client, auth_headers, "Beta")
    create_item(client, auth_headers, title="双标签一", tags=["Alpha", "Beta"])
    create_item(client, auth_headers, title="双标签二", tags=["Alpha", "Beta"])

    response = client.get(
        "/api/v1/items",
        params=[("tag_id", first_tag["id"]), ("tag_id", second_tag["id"])],
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["total"] == 2
    assert len(data["items"]) == 2
    assert len({row["id"] for row in data["items"]}) == 2


def test_tags_and_timeline_require_token(client: TestClient) -> None:
    assert client.get("/api/v1/tags").status_code == 401
    assert client.post("/api/v1/tags", json={"name": "x"}).status_code == 401
    assert client.get("/api/v1/timeline").status_code == 401
