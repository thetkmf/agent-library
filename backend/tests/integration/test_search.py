"""Search: keyword FTS, semantic, hybrid RRF, filters and degradation (§9.5, B6)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from app.core.config import Settings
from app.main import create_app
from app.services.embedding import DeterministicEmbedder, EmbeddingService
from app.services.indexing import IndexService
from app.services.search import SearchService
from app.services.vector_store import MemoryVectorStore
from fastapi.testclient import TestClient

TOKEN = "test-token-0123456789abcdef"
DIMENSION = 8


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return Settings(
        token=TOKEN,
        data_dir=tmp_path / "data",
        embedding_dimension=DIMENSION,
        chunk_chars=200,
        chunk_overlap_chars=10,
        _env_file=None,
    )


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture()
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def install_index(client: TestClient, *, ready: bool = True) -> MemoryVectorStore:
    state = client.app.state
    store = MemoryVectorStore()
    embedder = (
        EmbeddingService(state.settings, embedder=DeterministicEmbedder(dimension=DIMENSION))
        if ready
        else EmbeddingService(state.settings)
    )
    state.vector_store = store
    state.index_service = IndexService(
        state.settings, state.session_factory, store, embedder, synchronous=True
    )
    state.search_service = SearchService(state.settings, state.session_factory, store, embedder)
    return store


def create_note(
    client: TestClient,
    auth: dict[str, str],
    title: str,
    content: str,
    *,
    tags: list[str] | None = None,
    item_type: str = "note",
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/items",
        json={"type": item_type, "title": title, "content": content, "tags": tags or []},
        headers=auth,
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def do_search(client: TestClient, auth: dict[str, str], **params: Any) -> dict[str, Any]:
    response = client.get("/api/v1/search", params=params, headers=auth)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_keyword_search_returns_hits_with_snippet(client: TestClient, auth: dict[str, str]) -> None:
    install_index(client)
    create_note(client, auth, "向量检索入门", "向量检索通过嵌入做语义匹配。")
    create_note(client, auth, "完全无关", "今天天气不错。")

    data = do_search(client, auth, q="向量检索", mode="keyword")
    assert data["mode"] == "keyword"
    assert data["degraded"] is False
    assert data["total"] == 1
    hit = data["items"][0]
    assert hit["item"]["title"] == "向量检索入门"
    assert 0.0 <= hit["score"] <= 1.0
    assert hit["match_type"] == "keyword"
    assert "向量检索" in hit["snippet"]
    assert "<" not in hit["snippet"]


def test_short_cjk_query_falls_back_to_like(client: TestClient, auth: dict[str, str]) -> None:
    install_index(client)
    create_note(client, auth, "标签系统", "标签与时间轴。")
    data = do_search(client, auth, q="标签", mode="keyword")
    assert data["total"] == 1
    assert data["items"][0]["item"]["title"] == "标签系统"


def test_keyword_search_respects_filters(client: TestClient, auth: dict[str, str]) -> None:
    install_index(client)
    note = create_note(client, auth, "检索笔记", "检索内容。", tags=["检索标签"])
    create_note(client, auth, "检索便签", "检索内容。", item_type="tex")

    by_type = do_search(client, auth, q="检索", mode="keyword", type="tex")
    assert [hit["item"]["title"] for hit in by_type["items"]] == ["检索便签"]

    tag_id = note["tags"][0]["id"]
    by_tag = do_search(client, auth, q="检索", mode="keyword", tag_id=tag_id)
    assert [hit["item"]["id"] for hit in by_tag["items"]] == [note["id"]]


def test_fts_stays_in_sync_with_updates_and_delete(
    client: TestClient, auth: dict[str, str]
) -> None:
    install_index(client)
    note = create_note(client, auth, "旧标题", "旧内容关键词。")

    assert do_search(client, auth, q="旧标题", mode="keyword")["total"] == 1

    client.patch(
        f"/api/v1/items/{note['id']}",
        json={"title": "新标题", "expected_version": note["version"]},
        headers=auth,
    )
    assert do_search(client, auth, q="旧标题", mode="keyword")["total"] == 0
    assert do_search(client, auth, q="新标题", mode="keyword")["total"] == 1

    client.delete(f"/api/v1/items/{note['id']}", headers=auth)
    assert do_search(client, auth, q="新标题", mode="keyword")["total"] == 0

    client.post(f"/api/v1/items/{note['id']}/restore", headers=auth)
    assert do_search(client, auth, q="新标题", mode="keyword")["total"] == 1


def test_semantic_search_uses_vectors(client: TestClient, auth: dict[str, str]) -> None:
    install_index(client)
    create_note(client, auth, "纯文本内容", "第一次内容")
    create_note(client, auth, "另一条", "完全不同的主题")
    assert client.post("/api/v1/index/reindex", json={}, headers=auth).status_code == 202

    data = do_search(client, auth, q="第一次内容", mode="semantic")
    assert data["mode"] == "semantic"
    assert data["degraded"] is False
    assert data["items"][0]["item"]["title"] == "纯文本内容"
    assert data["items"][0]["match_type"] == "semantic"


def test_search_degrades_when_embeddings_missing(client: TestClient, auth: dict[str, str]) -> None:
    install_index(client, ready=False)
    create_note(client, auth, "关键词可用", "关键词检索。")

    data = do_search(client, auth, q="关键词", mode="semantic")
    assert data["degraded"] is True
    assert data["mode"] == "keyword"
    assert data["total"] == 1

    hybrid = do_search(client, auth, q="关键词", mode="hybrid")
    assert hybrid["degraded"] is True
    assert hybrid["mode"] == "keyword"


def test_hybrid_fuses_and_is_stable(client: TestClient, auth: dict[str, str]) -> None:
    install_index(client)
    first = create_note(client, auth, "混合检索", "混合检索融合关键词和向量。")
    create_note(client, auth, "向量检索", "向量检索相关内容。")
    assert client.post("/api/v1/index/reindex", json={}, headers=auth).status_code == 202

    data = do_search(client, auth, q="混合检索", mode="hybrid")
    assert data["mode"] == "hybrid"
    assert data["items"]
    ids = [hit["item"]["id"] for hit in data["items"]]
    assert first["id"] in ids
    assert data["items"][0]["score"] == pytest.approx(1.0)
    assert data["total"] >= len(data["items"])

    again = do_search(client, auth, q="混合检索", mode="hybrid")
    assert [hit["item"]["id"] for hit in again["items"]] == ids

    limited = do_search(client, auth, q="混合检索", mode="hybrid", limit=1)
    assert len(limited["items"]) == 1


def test_search_validates_parameters(client: TestClient, auth: dict[str, str]) -> None:
    install_index(client)
    for params in (
        {"q": ""},
        {"q": "   "},
        {"q": "x" * 201},
        {"q": "内容", "mode": "fuzzy"},
        {"q": "内容", "limit": 0},
        {"q": "内容", "limit": 101},
        {"q": "内容", "type": "spreadsheet"},
    ):
        response = client.get("/api/v1/search", params=params, headers=auth)
        assert response.status_code == 400, params
        assert response.json()["code"] == 40002


def test_search_requires_token(client: TestClient) -> None:
    assert client.get("/api/v1/search", params={"q": "内容"}).status_code == 401
