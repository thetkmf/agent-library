"""Knowledge graph queries: subgraph, neighbours, stats (§9.9, B11)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from app.core.config import Settings
from app.db.models import GraphEdge, GraphNode
from app.main import create_app
from fastapi.testclient import TestClient

TOKEN = "test-token-0123456789abcdef"


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return Settings(token=TOKEN, data_dir=tmp_path / "data", _env_file=None)


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture()
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def create_note(client: TestClient, auth: dict[str, str], title: str) -> dict[str, Any]:
    response = client.post(
        "/api/v1/items", json={"type": "note", "title": title, "content": "内容"}, headers=auth
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


@pytest.fixture()
def graph(client: TestClient, auth: dict[str, str]) -> dict[str, Any]:
    """Two item nodes chained to a tag node, plus one isolated node."""
    factory = client.app.state.session_factory
    first = create_note(client, auth, "向量检索")
    second = create_note(client, auth, "机器学习")
    with factory() as session:
        node_a = GraphNode(label="向量检索", type="item", item_id=first["id"], weight=0.9)
        node_b = GraphNode(label="机器学习", type="item", item_id=second["id"], weight=0.5)
        tag = GraphNode(label="ML", type="tag", weight=0.2)
        lonely = GraphNode(label="孤立概念", type="concept", weight=0.1)
        session.add_all([node_a, node_b, tag, lonely])
        session.flush()
        session.add_all(
            [
                GraphEdge(
                    source_id=node_a.id, target_id=tag.id, relation="tagged_with", weight=1.0
                ),
                GraphEdge(
                    source_id=node_b.id, target_id=tag.id, relation="tagged_with", weight=1.0
                ),
                GraphEdge(
                    source_id=node_a.id, target_id=node_b.id, relation="related_to", weight=0.6
                ),
            ]
        )
        session.commit()
        return {
            "a": node_a.id,
            "b": node_b.id,
            "tag": tag.id,
            "lonely": lonely.id,
            "item_a": first["id"],
            "item_b": second["id"],
        }


def test_full_graph_orders_and_truncates(
    client: TestClient, auth: dict[str, str], graph: dict[str, Any]
) -> None:
    data = client.get("/api/v1/graph", headers=auth).json()["data"]
    assert len(data["nodes"]) == 4
    assert data["nodes"][0]["label"] == "向量检索"
    assert all(edge["source"] in {node["id"] for node in data["nodes"]} for edge in data["edges"])
    assert len(data["edges"]) == 3

    limited = client.get("/api/v1/graph", params={"limit": 2}, headers=auth).json()["data"]
    assert len(limited["nodes"]) == 2
    kept = {node["id"] for node in limited["nodes"]}
    assert all(edge["source"] in kept and edge["target"] in kept for edge in limited["edges"])

    typed = client.get("/api/v1/graph", params={"types": "tag"}, headers=auth).json()["data"]
    assert [node["type"] for node in typed["nodes"]] == ["tag"]
    assert typed["edges"] == []


def test_subgraph_by_center_and_depth(
    client: TestClient, auth: dict[str, str], graph: dict[str, Any]
) -> None:
    depth1 = client.get(
        "/api/v1/graph", params={"center_id": graph["item_a"], "depth": 1}, headers=auth
    ).json()["data"]
    ids = {node["id"] for node in depth1["nodes"]}
    assert ids == {graph["a"], graph["b"], graph["tag"]}

    depth2 = client.get(
        "/api/v1/graph", params={"center_id": graph["a"], "depth": 2}, headers=auth
    ).json()["data"]
    assert {node["id"] for node in depth2["nodes"]} == ids

    missing = client.get("/api/v1/graph", params={"center_id": "nope"}, headers=auth)
    assert missing.status_code == 404
    assert missing.json()["code"] == 30001

    bad_depth = client.get("/api/v1/graph", params={"depth": 9}, headers=auth)
    assert bad_depth.status_code == 422


def test_neighbors_endpoint(
    client: TestClient, auth: dict[str, str], graph: dict[str, Any]
) -> None:
    data = client.get(f"/api/v1/graph/neighbors/{graph['item_a']}", headers=auth).json()["data"]
    assert {node["id"] for node in data["nodes"]} == {graph["a"], graph["b"], graph["tag"]}
    assert len(data["edges"]) == 3

    lonely_item = create_note(client, auth, "没有节点")
    empty = client.get(f"/api/v1/graph/neighbors/{lonely_item['id']}", headers=auth).json()["data"]
    assert empty == {"nodes": [], "edges": []}
    assert client.get("/api/v1/graph/neighbors/nope", headers=auth).status_code == 404


def test_stats_counts_isolated(
    client: TestClient, auth: dict[str, str], graph: dict[str, Any]
) -> None:
    stats = client.get("/api/v1/graph/stats", headers=auth).json()["data"]
    assert stats["node_count"] == 4
    assert stats["edge_count"] == 3
    assert stats["isolated_node_count"] == 1
    assert stats["updated_at"] is not None


def test_graph_requires_token(client: TestClient) -> None:
    assert client.get("/api/v1/graph").status_code == 401
    assert client.get("/api/v1/graph/stats").status_code == 401
