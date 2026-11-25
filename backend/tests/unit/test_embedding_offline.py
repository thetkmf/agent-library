"""Offline bundled embedding model loading (§13.23 B15)."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pytest
from app.core.config import Settings
from app.services import embedding as embedding_module
from app.services.embedding import (
    EmbeddingService,
    FastEmbedEmbedder,
    _verify_local_model_dir,
)

ONNX_NAME = "model_optimized.onnx"


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    base: dict[str, object] = {
        "token": "test-token-0123456789abcdef",
        "data_dir": tmp_path / "data",
        "_env_file": None,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def _make_model_dir(root: Path, *, with_tokenizer: bool = True) -> Path:
    model_dir = root / "bge-small-zh-v1.5"
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / ONNX_NAME).write_bytes(b"fake-onnx-weights")
    (model_dir / "config.json").write_text("{}", encoding="utf-8")
    (model_dir / "vocab.txt").write_text("a", encoding="utf-8")
    if with_tokenizer:
        (model_dir / "tokenizer.json").write_text("{}", encoding="utf-8")
    return model_dir


def test_verify_ready_with_optimized_onnx(tmp_path: Path) -> None:
    model_dir = _make_model_dir(tmp_path)
    digest = hashlib.sha256((model_dir / ONNX_NAME).read_bytes()).hexdigest()
    status = _verify_local_model_dir(model_dir, digest.upper())
    assert status == "ready"


def test_verify_detects_hash_mismatch(tmp_path: Path) -> None:
    model_dir = _make_model_dir(tmp_path)
    assert _verify_local_model_dir(model_dir, "0" * 64) == "error"


def test_verify_missing_files(tmp_path: Path) -> None:
    model_dir = _make_model_dir(tmp_path, with_tokenizer=False)
    assert _verify_local_model_dir(model_dir, None) == "missing"
    assert _verify_local_model_dir(tmp_path / "nope", None) == "missing"


def test_service_status_follows_model_dir(tmp_path: Path) -> None:
    model_dir = _make_model_dir(tmp_path)
    digest = hashlib.sha256((model_dir / ONNX_NAME).read_bytes()).hexdigest()
    service = EmbeddingService(
        _settings(tmp_path, embedding_model_dir=model_dir, embedding_model_sha256=digest)
    )
    assert service.status == "ready"
    assert service.describe().status == "ready"

    broken = EmbeddingService(
        _settings(tmp_path, embedding_model_dir=model_dir, embedding_model_sha256="f" * 64)
    )
    assert broken.status == "error"


def test_loader_uses_specific_model_path_offline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model_dir = _make_model_dir(tmp_path)
    captured: dict[str, object] = {}

    class FakeTextEmbedding:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

        def embed(self, texts: list[str]) -> list[list[float]]:
            return [[0.0] * 512 for _ in texts]

    monkeypatch.setenv("HF_HUB_OFFLINE", "0")
    monkeypatch.setattr("fastembed.TextEmbedding", FakeTextEmbedding, raising=False)
    settings = _settings(tmp_path, embedding_model_dir=model_dir)
    embedder = FastEmbedEmbedder(settings)
    vectors = embedder.embed_documents(["离线模型"])

    assert len(vectors[0]) == 512
    assert captured["specific_model_path"] == str(model_dir)
    assert captured["local_files_only"] is True
    assert "cache_dir" not in captured
    assert os.environ["HF_HUB_OFFLINE"] == "1"
    assert embedding_module.FASTEMBED_MODEL_ID in str(captured["model_name"])


def test_service_lazily_builds_embedder_when_model_ready(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """随包模型不需要预热任务：首次编码时惰性构建嵌入器（B15 修复）。"""
    model_dir = _make_model_dir(tmp_path)
    created: list[object] = []

    class FakeEmbedder:
        name = "fake"
        dimension = 512

        def __init__(self, settings: object) -> None:
            created.append(settings)

        def embed_documents(self, texts: list[str]) -> list[list[float]]:
            return [[0.5] * 512 for _ in texts]

    monkeypatch.setattr(embedding_module, "FastEmbedEmbedder", FakeEmbedder)
    service = EmbeddingService(_settings(tmp_path, embedding_model_dir=model_dir))
    vectors = service.embed_documents(["离线"])
    assert len(vectors[0]) == 512
    assert created  # 只在首次使用时构建一次
    assert service.embed_documents(["再来一次"])[0][0] == 0.5
    assert len(created) == 1


def test_service_without_model_refuses_to_encode(tmp_path: Path) -> None:
    from app.core.errors import AppError, ErrorCode

    service = EmbeddingService(_settings(tmp_path))
    with pytest.raises(AppError) as excinfo:
        service.embed_documents(["文本"])
    assert excinfo.value.code is ErrorCode.MODEL_NOT_CONFIGURED
