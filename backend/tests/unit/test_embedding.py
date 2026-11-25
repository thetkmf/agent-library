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


def _write_complete_model(model_dir: Path, *, onnx_name: str = "model.onnx") -> bytes:
    """13.23：离线模型目录必须含 onnx + tokenizer.json + config.json + vocab.txt。"""
    model_dir.mkdir(parents=True, exist_ok=True)
    payload = b"fake-model"
    (model_dir / onnx_name).write_bytes(payload)
    (model_dir / "tokenizer.json").write_text("{}", encoding="utf-8")
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    (model_dir / "vocab.txt").write_text("a", encoding="utf-8")
    return payload


def test_model_sha256_mismatch_marks_error(tmp_path: Path) -> None:
    model_dir = tmp_path / "model"
    _write_complete_model(model_dir)
    service = EmbeddingService(
        _settings(tmp_path, embedding_model_dir=model_dir, embedding_model_sha256="0" * 64)
    )
    assert service.status == "error"


def test_model_sha256_match_marks_ready(tmp_path: Path) -> None:
    import hashlib

    model_dir = tmp_path / "model"
    payload = _write_complete_model(model_dir)
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
