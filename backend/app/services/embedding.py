"""Local embedding service with lazy model loading (§13.15 B5a-1/B5a-2)."""

from __future__ import annotations

import hashlib
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

from ..core.config import Settings
from ..core.errors import AppError, ErrorCode
from ..core.logging import get_logger
from ..core.paths import build_layout

logger = get_logger("pkb.embedding")

MODEL_NAME = "bge-small-zh-v1.5"
FASTEMBED_MODEL_ID = "BAAI/bge-small-zh-v1.5"


@runtime_checkable
class Embedder(Protocol):
    """Minimal embedder contract used by the services and tests."""

    name: str
    dimension: int

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        """Return one vector per input text."""


class DeterministicEmbedder:
    """Hash based embedder: deterministic, offline and dependency free."""

    def __init__(self, dimension: int = 512, name: str = "deterministic-test") -> None:
        self.dimension = dimension
        self.name = name

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            raw = (digest * ((self.dimension * 4 // len(digest)) + 1))[: self.dimension * 4]
            values = [
                int.from_bytes(raw[index : index + 4], "little") / 2**32 - 0.5
                for index in range(0, self.dimension * 4, 4)
            ]
            norm = sum(value * value for value in values) ** 0.5 or 1.0
            vectors.append([value / norm for value in values])
        return vectors


class FastEmbedEmbedder:
    """fastembed/onnxruntime backed embedder; model loads on first use."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.dimension = settings.embedding_dimension
        self.name = MODEL_NAME
        self._model: object | None = None
        self._lock = threading.Lock()

    @property
    def cache_dir(self) -> Path:
        return build_layout(self.settings).cache_dir / "fastembed"

    def _load(self) -> object:
        if self._model is not None:
            return self._model
        with self._lock:
            if self._model is not None:  # pragma: no cover - 双检锁
                return self._model
            try:
                from fastembed import TextEmbedding
            except ImportError as exc:  # pragma: no cover - 依赖缺失时
                raise AppError(ErrorCode.EMBEDDING_FAILED, "本地嵌入组件未安装") from exc
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            self._model = TextEmbedding(
                model_name=FASTEMBED_MODEL_ID,
                cache_dir=str(self.cache_dir),
                threads=self.settings.embedding_max_workers,
            )
            return self._model

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        model = self._load()
        embed = getattr(model, "embed", None)
        if embed is None:  # pragma: no cover - fastembed API 变更
            raise AppError(ErrorCode.EMBEDDING_FAILED, "嵌入模型不可用")
        try:
            vectors = [list(map(float, vector)) for vector in embed(list(texts))]
        except Exception as exc:  # pragma: no cover - 推理侧异常
            logger.error("embedding.infer_failed", extra={"fields": {"reason": type(exc).__name__}})
            raise AppError(ErrorCode.EMBEDDING_FAILED, "向量化失败") from exc
        return vectors


@dataclass(frozen=True, slots=True)
class EmbeddingStatus:
    """Current state of the local embedding stack."""

    model: str
    dimension: int
    status: str  # ready / missing / loading / error

    @property
    def ready(self) -> bool:
        return self.status == "ready"


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class EmbeddingService:
    """Wraps an embedder and exposes status + batched encoding."""

    def __init__(self, settings: Settings, embedder: Embedder | None = None) -> None:
        self.settings = settings
        self._embedder = embedder
        self._status = "missing"

    # ---- status -----------------------------------------------------
    def _model_dir(self) -> Path | None:
        if self.settings.embedding_model_dir is not None:
            return Path(self.settings.embedding_model_dir)
        return None

    def verify_model(self) -> str:
        """Check local model files without downloading anything."""
        model_dir = self._model_dir()
        if model_dir is not None:
            if not model_dir.is_dir():
                return "missing"
            expected = self.settings.embedding_model_sha256
            if expected:
                digest = _sha256_of(model_dir / "model.onnx")
                if digest != expected.strip().lower():
                    logger.error("embedding.model_hash_mismatch")
                    return "error"
        elif not self._fastembed_cache_present():
            return "missing"
        return "ready"

    def _fastembed_cache_present(self) -> bool:
        cache = build_layout(self.settings).cache_dir / "fastembed"
        return cache.is_dir() and any(cache.glob("models--*"))

    @property
    def status(self) -> str:
        if self._embedder is not None:
            self._status = "ready"
        else:
            self._status = self.verify_model()
        return self._status

    def describe(self) -> EmbeddingStatus:
        return EmbeddingStatus(
            model=self.settings.embedding_model,
            dimension=self.settings.embedding_dimension,
            status=self.status,
        )

    def warm_up(self) -> str:
        """Load the model explicitly (used by the reindex task)."""
        if self._embedder is None:
            self._status = "loading"
            self._embedder = FastEmbedEmbedder(self.settings)
        try:
            self._embedder.embed_documents(["预热"])
        except AppError:
            self._status = "error"
            raise
        self._status = "ready"
        return self._status

    # ---- encode -----------------------------------------------------
    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        """Batch encode texts, validating the configured dimension."""
        if not texts:
            return []
        embedder = self._embedder
        if embedder is None:
            raise AppError(ErrorCode.MODEL_NOT_CONFIGURED, "本地嵌入模型尚未就绪")
        vectors: list[list[float]] = []
        batch = max(1, self.settings.embedding_batch_size)
        for start in range(0, len(texts), batch):
            window = list(texts[start : start + batch])
            produced = embedder.embed_documents(window)
            if len(produced) != len(window):
                raise AppError(ErrorCode.EMBEDDING_FAILED, "向量数量与文本数量不一致")
            for vector in produced:
                if len(vector) != self.settings.embedding_dimension:
                    raise AppError(
                        ErrorCode.EMBEDDING_FAILED,
                        "向量维度与配置不一致",
                        details={
                            "expected": self.settings.embedding_dimension,
                            "actual": len(vector),
                        },
                    )
                vectors.append(vector)
        return vectors
