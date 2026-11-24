"""Chunk vector storage backed by Chroma (B5a-4)."""

from __future__ import annotations

import hashlib
import math
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from ..core.config import Settings
from ..core.logging import get_logger
from ..core.paths import build_layout

logger = get_logger("pkb.vector")

COLLECTION_NAME = "pkb_chunks"


@dataclass(frozen=True, slots=True)
class ChunkRecord:
    """One embedded chunk ready for storage."""

    item_id: str
    chunk_index: int
    text: str
    embedding: list[float]
    model: str
    dimension: int

    @property
    def chunk_id(self) -> str:
        return f"{self.item_id}:{self.chunk_index}"

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.text.encode("utf-8")).hexdigest()

    def metadata(self) -> dict[str, Any]:
        return {
            "item_id": self.item_id,
            "chunk_index": self.chunk_index,
            "content_hash": self.content_hash,
            "model": self.model,
            "dimension": self.dimension,
        }


@dataclass(frozen=True, slots=True)
class VectorHit:
    """One matched chunk returned by a similarity query."""

    item_id: str
    chunk_index: int
    text: str
    score: float
    content_hash: str


class VectorStore(Protocol):
    """Minimal vector store contract shared by Chroma and the in-memory store."""

    def upsert_item(self, records: Sequence[ChunkRecord]) -> int:
        """Insert or replace every chunk of an item; returns stored count."""

    def delete_item(self, item_id: str) -> None:
        """Remove every chunk of an item."""

    def count(self) -> int:
        """Total number of stored chunks."""

    def item_chunk_count(self, item_id: str) -> int:
        """Number of stored chunks of one item."""

    def item_ids(self) -> set[str]:
        """Return every item id that currently has vectors."""

    def query(
        self, embedding: Sequence[float], *, limit: int, item_ids: Sequence[str] | None = None
    ) -> list[VectorHit]:
        """Return the closest chunks."""


class MemoryVectorStore:
    """In-memory store used by tests and as a fallback when Chroma is absent."""

    def __init__(self) -> None:
        self._rows: dict[str, ChunkRecord] = {}
        self._lock = threading.Lock()

    def upsert_item(self, records: Sequence[ChunkRecord]) -> int:
        with self._lock:
            for record in records:
                self._rows[record.chunk_id] = record
            return len(records)

    def delete_item(self, item_id: str) -> None:
        with self._lock:
            for key in [key for key, row in self._rows.items() if row.item_id == item_id]:
                del self._rows[key]

    def count(self) -> int:
        return len(self._rows)

    def item_chunk_count(self, item_id: str) -> int:
        return sum(1 for row in self._rows.values() if row.item_id == item_id)

    def item_ids(self) -> set[str]:
        return {row.item_id for row in self._rows.values()}

    def query(
        self, embedding: Sequence[float], *, limit: int, item_ids: Sequence[str] | None = None
    ) -> list[VectorHit]:
        allowed = set(item_ids) if item_ids else None
        scored: list[VectorHit] = []
        for row in self._rows.values():
            if allowed is not None and row.item_id not in allowed:
                continue
            score = _cosine(embedding, row.embedding)
            scored.append(
                VectorHit(
                    item_id=row.item_id,
                    chunk_index=row.chunk_index,
                    text=row.text,
                    score=score,
                    content_hash=row.content_hash,
                )
            )
        scored.sort(key=lambda hit: (-hit.score, hit.item_id, hit.chunk_index))
        return scored[:limit]


def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
    total = sum(float(a) * float(b) for a, b in zip(left, right, strict=False))
    left_norm = math.sqrt(sum(float(value) ** 2 for value in left))
    right_norm = math.sqrt(sum(float(value) ** 2 for value in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return float(total / (left_norm * right_norm))


class ChromaVectorStore:
    """Chroma persistent store; the client opens lazily on first use."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client: Any = None
        self._collection: Any = None
        self._lock = threading.Lock()

    @property
    def path(self) -> Path:
        return build_layout(self.settings).data_dir / "chroma"

    def _get_collection(self) -> Any:
        if self._collection is not None:
            return self._collection
        with self._lock:
            if self._collection is not None:  # pragma: no cover - 双检锁
                return self._collection
            import chromadb

            self.path.mkdir(parents=True, exist_ok=True)
            self._client = chromadb.PersistentClient(path=str(self.path))
            self._collection = self._client.get_or_create_collection(
                name=COLLECTION_NAME,
                metadata={"hnsw:space": "cosine"},
            )
            return self._collection

    def upsert_item(self, records: Sequence[ChunkRecord]) -> int:
        if not records:
            return 0
        collection = self._get_collection()
        collection.upsert(
            ids=[record.chunk_id for record in records],
            embeddings=[list(record.embedding) for record in records],
            documents=[record.text for record in records],
            metadatas=[record.metadata() for record in records],
        )
        return len(records)

    def delete_item(self, item_id: str) -> None:
        collection = self._get_collection()
        collection.delete(where={"item_id": item_id})

    def count(self) -> int:
        return int(self._get_collection().count())

    def item_chunk_count(self, item_id: str) -> int:
        result = self._get_collection().get(where={"item_id": item_id}, include=[])
        ids = result.get("ids") or []
        return len(ids)

    def item_ids(self) -> set[str]:
        result = self._get_collection().get(include=["metadatas"])
        metadatas = result.get("metadatas") or []
        return {str(meta.get("item_id")) for meta in metadatas if meta}

    def query(
        self, embedding: Sequence[float], *, limit: int, item_ids: Sequence[str] | None = None
    ) -> list[VectorHit]:
        collection = self._get_collection()
        where: dict[str, Any] | None = None
        if item_ids:
            where = {"item_id": {"$in": list(item_ids)}}
        result = collection.query(
            query_embeddings=[list(embedding)],
            n_results=limit,
            where=where,
            include=["documents", "metadatas", "distances"],
        )
        ids = (result.get("ids") or [[]])[0]
        documents = (result.get("documents") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        hits: list[VectorHit] = []
        for index in range(len(ids)):
            metadata = metadatas[index] or {}
            distance = float(distances[index]) if index < len(distances) else 1.0
            hits.append(
                VectorHit(
                    item_id=str(metadata.get("item_id", "")),
                    chunk_index=int(metadata.get("chunk_index", 0)),
                    text=str(documents[index]) if index < len(documents) else "",
                    score=max(0.0, 1.0 - distance),
                    content_hash=str(metadata.get("content_hash", "")),
                )
            )
        return hits


def build_vector_store(settings: Settings) -> VectorStore | None:
    """Return a Chroma store when the dependency is importable, else None."""
    try:
        import chromadb  # noqa: F401
    except ImportError:  # pragma: no cover - 依赖缺失时
        logger.warning("vector.chroma_missing")
        return None
    try:
        return ChromaVectorStore(settings)
    except Exception as exc:  # pragma: no cover - 初始化异常
        logger.error("vector.store_init_failed", extra={"fields": {"reason": type(exc).__name__}})
        return None
