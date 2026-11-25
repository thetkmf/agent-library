"""Local embedding service with lazy model loading (§13.15 B5a-1/B5a-2)."""

from __future__ import annotations

import hashlib
import os
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
# fastembed 的 ONNX 文件名（新版导出为 model_optimized.onnx，旧版为 model.onnx）
LOCAL_ONNX_NAMES = ("model_optimized.onnx", "model.onnx")
REQUIRED_MODEL_FILES = ("tokenizer.json", "config.json", "vocab.txt")


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

    @property
    def model_dir(self) -> Path | None:
        """Offline model directory configured by the installer (``PKB_EMBEDDING_MODEL_DIR``)."""
        if self.settings.embedding_model_dir is None:
            return None
        return Path(self.settings.embedding_model_dir)

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
            model_dir = self.model_dir
            if model_dir is not None:
                # 随包模型：只从本地目录加载，禁止联网与写缓存
                # 显式强制离线：随包模型只读本地目录，杜绝任何外网尝试
                os.environ["HF_HUB_OFFLINE"] = "1"
                os.environ["TRANSFORMERS_OFFLINE"] = "1"
                try:
                    self._model = TextEmbedding(
                        model_name=FASTEMBED_MODEL_ID,
                        specific_model_path=str(model_dir),
                        local_files_only=True,
                        threads=self.settings.embedding_max_workers,
                    )
                except Exception as exc:  # pragma: no cover - 依赖/文件异常
                    logger.error(
                        "embedding.offline_load_failed",
                        extra={"fields": {"reason": type(exc).__name__}},
                    )
                    raise AppError(ErrorCode.EMBEDDING_FAILED, "离线嵌入模型加载失败") from exc
                return self._model
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


def _verify_local_model_dir(model_dir: Path, expected_sha256: str | None) -> str:
    """Return ready/missing/error for an offline model directory (§13.23 B15)."""
    if not model_dir.is_dir():
        return "missing"
    if any(not (model_dir / name).is_file() for name in REQUIRED_MODEL_FILES):
        return "missing"
    onnx_file = next(
        (model_dir / name for name in LOCAL_ONNX_NAMES if (model_dir / name).is_file()), None
    )
    if onnx_file is None:
        return "missing"
    if expected_sha256:
        digest = _sha256_of(onnx_file)
        if digest != expected_sha256.strip().lower():
            logger.error(
                "embedding.model_hash_mismatch", extra={"fields": {"file": onnx_file.name}}
            )
            return "error"
    return "ready"


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
            return _verify_local_model_dir(model_dir, self.settings.embedding_model_sha256)
        if not self._fastembed_cache_present():
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
    def _ensure_embedder(self) -> Embedder:
        """Lazily build the fastembed embedder when the model is available locally.

        随包模型（``embedding_model_dir``）在安装包里是常驻资源，不需要等预热任务；
        第一次索引/检索时才构建，避免启动变慢。
        """
        if self._embedder is not None:
            return self._embedder
        if self.verify_model() != "ready":
            raise AppError(ErrorCode.MODEL_NOT_CONFIGURED, "本地嵌入模型尚未就绪")
        self._embedder = FastEmbedEmbedder(self.settings)
        return self._embedder

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        """Batch encode texts, validating the configured dimension."""
        if not texts:
            return []
        embedder = self._ensure_embedder()
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
