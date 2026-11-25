"""Reindex task, status endpoint and item ↔ vector linkage (§9.5, B5)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from app.core.config import Settings
from app.db.base import utcnow
from app.db.models import AiTask
from app.main import create_app
from app.services.embedding import DeterministicEmbedder, EmbeddingService
from app.services.indexing import IndexService
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
        chunk_overlap_chars=20,
        _env_file=None,
    )


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture()
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def install_sync_index(
    client: TestClient, *, ready: bool = True
) -> tuple[IndexService, MemoryVectorStore]:
    """Swap in a synchronous index service with an offline embedder."""
    state = client.app.state
    store = MemoryVectorStore()
    embedder = (
        EmbeddingService(state.settings, embedder=DeterministicEmbedder(dimension=DIMENSION))
        if ready
        else EmbeddingService(state.settings)
    )
    service = IndexService(state.settings, state.session_factory, store, embedder, synchronous=True)
    state.vector_store = store
    state.index_service = service
    return service, store


def create_note(
    client: TestClient, auth: dict[str, str], title: str, content: str
) -> dict[str, Any]:
    response = client.post(
        "/api/v1/items",
        json={"type": "note", "title": title, "content": content},
        headers=auth,
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_reindex_indexes_pending_notes(client: TestClient, auth: dict[str, str]) -> None:
    _, store = install_sync_index(client)
    note = create_note(client, auth, "向量检索", "向量检索与倒数排名融合。\n\n第二段内容。")

    accepted = client.post("/api/v1/index/reindex", json={}, headers=auth)
    assert accepted.status_code == 202, accepted.text
    body = accepted.json()["data"]
    assert body["type"] == "reindex"
    assert body["task_id"]
    assert body["status"] in {"queued", "running", "succeeded"}

    status = client.get("/api/v1/index/status", headers=auth).json()["data"]
    assert status["ready"] is True
    assert status["indexed_count"] == 1
    assert status["pending_count"] == 0
    assert status["embedding"]["status"] == "ready"
    assert status["embedding"]["dimension"] == DIMENSION
    assert status["task"]["status"] == "succeeded"
    assert status["task"]["progress"] == 100
    assert status["last_updated_at"] is not None
    assert store.item_chunk_count(note["id"]) >= 1

    refreshed = client.get(f"/api/v1/items/{note['id']}", headers=auth).json()["data"]
    assert refreshed["embedding_status"] == "indexed"


def test_reindex_rejects_concurrent_task(client: TestClient, auth: dict[str, str]) -> None:
    install_sync_index(client)
    factory = client.app.state.session_factory
    with factory() as session:
        session.add(
            AiTask(type="reindex", status="running", progress=40, input_data={"mode": "full"})
        )
        session.commit()

    response = client.post("/api/v1/index/reindex", json={"mode": "full"}, headers=auth)
    assert response.status_code == 409
    assert response.json()["code"] == 30002
    assert response.json()["data"]["status"] == "running"


def test_reindex_requires_ready_embeddings(client: TestClient, auth: dict[str, str]) -> None:
    install_sync_index(client, ready=False)
    response = client.post("/api/v1/index/reindex", json={}, headers=auth)
    assert response.status_code == 409
    assert response.json()["code"] == 50001


def test_unsupported_file_is_skipped_and_text_file_indexed(
    client: TestClient, auth: dict[str, str]
) -> None:
    _, store = install_sync_index(client)
    binary = client.post(
        "/api/v1/files", files={"file": ("论文.pdf", b"%PDF-1.4", "application/pdf")}, headers=auth
    )
    assert binary.status_code == 201
    text_file = client.post(
        "/api/v1/files",
        files={"file": ("笔记.md", b"# markdown \xe6\xad\xa3\xe6\x96\x87", "text/markdown")},
        headers=auth,
    )
    assert text_file.status_code == 201

    client.post("/api/v1/index/reindex", json={"mode": "full"}, headers=auth)

    pdf_item = binary.json()["data"]["item"]
    md_item = text_file.json()["data"]["item"]
    assert (
        client.get(f"/api/v1/items/{pdf_item['id']}", headers=auth).json()["data"][
            "embedding_status"
        ]
        == "skipped"
    )
    assert (
        client.get(f"/api/v1/items/{md_item['id']}", headers=auth).json()["data"][
            "embedding_status"
        ]
        == "indexed"
    )
    assert store.item_chunk_count(pdf_item["id"]) == 0
    assert store.item_chunk_count(md_item["id"]) >= 1


def test_delete_removes_vectors(client: TestClient, auth: dict[str, str]) -> None:
    _, store = install_sync_index(client)
    note = create_note(client, auth, "待删除", "内容")
    client.post("/api/v1/index/reindex", json={}, headers=auth)
    assert store.count() > 0

    client.delete(f"/api/v1/items/{note['id']}", headers=auth)
    assert store.count() == 0


def test_full_reindex_prunes_orphan_vectors(client: TestClient, auth: dict[str, str]) -> None:
    _service, store = install_sync_index(client)
    from app.services.vector_store import ChunkRecord

    store.upsert_item(
        [
            ChunkRecord(
                item_id="ghost-item",
                chunk_index=0,
                text="孤儿向量",
                embedding=[0.1] * DIMENSION,
                model="deterministic-test",
                dimension=DIMENSION,
            )
        ]
    )
    assert store.item_chunk_count("ghost-item") == 1

    create_note(client, auth, "真实条目", "正文")
    client.post("/api/v1/index/reindex", json={"mode": "full"}, headers=auth)
    assert store.item_chunk_count("ghost-item") == 0


def test_incremental_only_touches_pending(client: TestClient, auth: dict[str, str]) -> None:
    _, store = install_sync_index(client)
    note = create_note(client, auth, "增量", "第一次内容")
    client.post("/api/v1/index/reindex", json={}, headers=auth)
    first_chunks = store.item_chunk_count(note["id"])
    assert first_chunks >= 1

    updated = client.put(
        f"/api/v1/items/{note['id']}/content",
        params={"expected_version": 1},
        content="第二次内容，更长一些。",
        headers={**auth, "Content-Type": "text/plain"},
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["embedding_status"] == "pending"

    client.post("/api/v1/index/reindex", json={"mode": "incremental"}, headers=auth)
    refreshed = client.get(f"/api/v1/items/{note['id']}", headers=auth).json()["data"]
    assert refreshed["embedding_status"] == "indexed"


def test_recover_interrupted_tasks(client: TestClient) -> None:
    service, _ = install_sync_index(client)
    factory = client.app.state.session_factory
    with factory() as session:
        task = AiTask(type="reindex", status="running", progress=30, input_data={"mode": "full"})
        session.add(task)
        session.commit()
        task_id = task.id

    assert service.recover_interrupted() == 1
    with factory() as session:
        recovered = session.get(AiTask, task_id)
        assert recovered is not None
        assert recovered.status == "failed"
        assert recovered.finished_at is not None


def test_canceled_task_is_not_executed(client: TestClient, auth: dict[str, str]) -> None:
    service, store = install_sync_index(client)
    create_note(client, auth, "取消", "内容")
    factory = client.app.state.session_factory
    with factory() as session:
        task = AiTask(type="reindex", status="canceled", progress=0, input_data={"mode": "full"})
        session.add(task)
        session.commit()
        task_id = task.id

    service.run_task(task_id)
    assert store.count() == 0


def test_index_endpoints_require_token(client: TestClient) -> None:
    assert client.post("/api/v1/index/reindex", json={}).status_code == 401
    assert client.get("/api/v1/index/status").status_code == 401


def test_status_without_tasks_reports_nulls(client: TestClient, auth: dict[str, str]) -> None:
    install_sync_index(client)
    data = client.get("/api/v1/index/status", headers=auth).json()["data"]
    assert data["indexed_count"] == 0
    assert data["pending_count"] == 0
    assert data["task"] is None
    assert data["last_updated_at"] is None


def test_status_reports_failed_task(client: TestClient, auth: dict[str, str]) -> None:
    """B15 修复：失败的重建任务也要出现在 /index/status，便于前端提示重试。"""
    install_sync_index(client)
    factory = client.app.state.session_factory
    with factory() as session:
        task = AiTask(
            type="reindex",
            status="failed",
            progress=100,
            input_data={"mode": "full"},
            error_data={"code": 50006, "message": "1 个条目索引失败"},
            finished_at=utcnow(),
        )
        session.add(task)
        session.commit()
        task_id = task.id

    status = client.get("/api/v1/index/status", headers=auth).json()["data"]
    assert status["task"]["id"] == task_id
    assert status["task"]["status"] == "failed"
