"""System information services."""

from __future__ import annotations

import platform
import shutil
from pathlib import Path
from typing import Any

from ..core.config import API_VERSION, MODEL_PROVIDER, Settings
from ..core.paths import build_layout
from .embedding import EmbeddingService


def _existing_ancestor(path: Path) -> Path:
    candidate = path
    while not candidate.exists() and candidate != candidate.parent:
        candidate = candidate.parent
    return candidate


def describe_service(settings: Settings) -> dict[str, Any]:
    """Build the /system/info payload."""
    layout = build_layout(settings)
    return {
        "app_version": settings.app_version,
        "backend_version": settings.app_version,
        "api_version": API_VERSION,
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "data_dir": str(layout.data_dir),
        "environment": settings.environment,
    }


def has_model_key() -> bool:
    """Report whether a DeepSeek key is stored in the Windows credential manager.

    Reading the credential manager is part of B12; until then no key is configured.
    """
    return False


def capabilities(
    settings: Settings, *, vector_ready: bool = False, indexed_count: int = 0
) -> dict[str, Any]:
    """Build the /system/capabilities payload."""
    layout = build_layout(settings)
    usage = shutil.disk_usage(str(_existing_ancestor(layout.data_dir)))
    has_key = has_model_key()
    embedding = EmbeddingService(settings).describe()
    return {
        "ai": {
            "provider": MODEL_PROVIDER,
            "model": settings.model_name,
            "has_key": has_key,
            "external_calls_enabled": settings.privacy_allow_external_calls,
            "ready": has_key and settings.privacy_allow_external_calls,
        },
        "embedding": {
            "model": embedding.model,
            "dimension": embedding.dimension,
            "status": embedding.status,
        },
        "vector": {
            "ready": vector_ready and embedding.ready,
            "indexed_count": indexed_count,
        },
        "storage": {"free_bytes": usage.free},
    }
