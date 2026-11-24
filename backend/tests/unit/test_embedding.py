"""Embedding service: status, batching and dimension checks (B5a-1/2)."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import pytest
from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.services.embedding import (
    DeterministicEmbedder,
    EmbeddingService,
    FastEmbedEmbedder,
)


class CountingEmbedder:
    """Deterministic embedder that records how many calls were made."""

    def __init__(self, dimension: int = 512) -> None:
        self.inner = DeterministicEmbedder(dimension=dimension)
        self.dimension = dimension
        self.name = "counting"
        self.calls: list[int] = []

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        self.calls.append(len(texts))
        return self.inner.embed_documents(texts)


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    return Settings(data_dir=tmp_path / "data", _env_file=None, **overrides)  # type: ignore[arg-type]


def test_deterministic_embedder_is_stable_and_normalised() -> None:
    embedder = DeterministicEmbedder(dimension=512)
    first = embedder.embed_documents(["同一条文本"])[0]
    second = embedder.embed_documents(["同一条文本"])[0]
    assert first == second
    assert len(first) == 512
    norm = sum(value * value for value in first) ** 0.5
    assert abs(norm - 1.0) < 1e-6


def test_embedding_service_batches_requests(tmp_path: Path) -> None:
    embedder = CountingEmbedder()
    service = EmbeddingService(_settings(tmp_path, embedding_batch_size=2), embedder=embedder)
    vectors = service.embed_documents(["a", "b", "c", "d", "e"])
    assert len(vectors) == 5
    assert embedder.calls == [2, 2, 1]
    assert service.status == "ready"


def test_embedding_service_rejects_wrong_dimension(tmp_path: Path) -> None:
    service = EmbeddingService(
        _settings(tmp_path, embedding_dimension=8), embedder=DeterministicEmbedder(dimension=4)
    )
    with pytest.raises(AppError) as excinfo:
        service.embed_documents(["文本"])
    assert excinfo.value.code == ErrorCode.EMBEDDING_FAILED


def test_status_is_missing_without_model(tmp_path: Path) -> None:
    service = EmbeddingService(_settings(tmp_path))
    described = service.describe()
    assert described.status == "missing"
    assert described.model == "bge-small-zh-v1.5"
    assert described.dimension == 512
    assert described.ready is False


def test_embedding_without_model_raises_model_not_configured(tmp_path: Path) -> None:
    service = EmbeddingService(_settings(tmp_path))
    with pytest.raises(AppError) as excinfo:
        service.embed_documents(["文本"])
    assert excinfo.value.code == ErrorCode.MODEL_NOT_CONFIGURED


def test_model_sha256_mismatch_marks_error(tmp_path: Path) -> None:
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    (model_dir / "model.onnx").write_bytes(b"fake-model")
    service = EmbeddingService(
        _settings(tmp_path, embedding_model_dir=model_dir, embedding_model_sha256="0" * 64)
    )
    assert service.status == "error"


def test_model_sha256_match_marks_ready(tmp_path: Path) -> None:
    import hashlib

    model_dir = tmp_path / "model"
    model_dir.mkdir()
    payload = b"fake-model"
    (model_dir / "model.onnx").write_bytes(payload)
    service = EmbeddingService(
        _settings(
            tmp_path,
            embedding_model_dir=model_dir,
            embedding_model_sha256=hashlib.sha256(payload).hexdigest(),
        )
    )
    assert service.status == "ready"


def test_fastembed_embedder_reports_configured_dimension(tmp_path: Path) -> None:
    embedder = FastEmbedEmbedder(_settings(tmp_path))
    assert embedder.dimension == 512
    assert embedder.name == "bge-small-zh-v1.5"
    assert embedder.cache_dir.name == "fastembed"
