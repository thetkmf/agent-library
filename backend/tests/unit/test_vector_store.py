"""Vector store: metadata, upsert/delete and similarity round-trip (B5a-4)."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.core.config import Settings
from app.services.embedding import DeterministicEmbedder
from app.services.vector_store import (
    ChromaVectorStore,
    ChunkRecord,
    MemoryVectorStore,
    build_vector_store,
)

DIMENSION = 16


def _records(item_id: str, texts: list[str]) -> list[ChunkRecord]:
    embedder = DeterministicEmbedder(dimension=DIMENSION)
    vectors = embedder.embed_documents(texts)
    return [
        ChunkRecord(
            item_id=item_id,
            chunk_index=index,
            text=text,
            embedding=vector,
            model="deterministic-test",
            dimension=DIMENSION,
        )
        for index, (text, vector) in enumerate(zip(texts, vectors, strict=True))
    ]


def _settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data", embedding_dimension=DIMENSION, _env_file=None)


@pytest.mark.parametrize("kind", ["memory", "chroma"])
def test_roundtrip_and_delete(tmp_path: Path, kind: str) -> None:
    if kind == "memory":
        store = MemoryVectorStore()
    else:
        pytest.importorskip("chromadb")
        store = ChromaVectorStore(_settings(tmp_path))

    records = _records("item-1", ["向量检索", "倒数排名融合"])
    assert store.upsert_item(records) == 2
    assert store.count() == 2
    assert store.item_chunk_count("item-1") == 2

    hits = store.query(records[0].embedding, limit=2)
    assert hits[0].item_id == "item-1"
    assert hits[0].chunk_index == 0
    assert hits[0].text == "向量检索"
    assert hits[0].score >= 0.99
    assert hits[0].content_hash == records[0].content_hash

    store.delete_item("item-1")
    assert store.count() == 0
    assert store.item_chunk_count("item-1") == 0


@pytest.mark.parametrize("kind", ["memory", "chroma"])
def test_upsert_replaces_existing_chunks(tmp_path: Path, kind: str) -> None:
    if kind == "memory":
        store = MemoryVectorStore()
    else:
        pytest.importorskip("chromadb")
        store = ChromaVectorStore(_settings(tmp_path))

    store.upsert_item(_records("item-2", ["第一版内容"]))
    store.upsert_item(_records("item-2", ["第二版内容", "补充内容"]))
    assert store.count() == 2
    hits = store.query(_records("item-2", ["第二版内容"])[0].embedding, limit=2)
    assert {hit.text for hit in hits} == {"第二版内容", "补充内容"}


@pytest.mark.parametrize("kind", ["memory", "chroma"])
def test_query_filters_by_item(tmp_path: Path, kind: str) -> None:
    if kind == "memory":
        store = MemoryVectorStore()
    else:
        pytest.importorskip("chromadb")
        store = ChromaVectorStore(_settings(tmp_path))

    store.upsert_item(_records("item-a", ["A 的内容"]))
    store.upsert_item(_records("item-b", ["B 的内容"]))
    hits = store.query(_records("item-a", ["A 的内容"])[0].embedding, limit=5, item_ids=["item-b"])
    assert {hit.item_id for hit in hits} == {"item-b"}


def test_metadata_contains_required_fields() -> None:
    record = _records("item-3", ["内容"])[0]
    metadata = record.metadata()
    assert metadata["item_id"] == "item-3"
    assert metadata["chunk_index"] == 0
    assert metadata["model"] == "deterministic-test"
    assert metadata["dimension"] == DIMENSION
    assert len(metadata["content_hash"]) == 64
    assert record.chunk_id == "item-3:0"


def test_build_vector_store_returns_chroma_when_available(tmp_path: Path) -> None:
    store = build_vector_store(_settings(tmp_path))
    assert store is not None
    assert store.count() == 0
