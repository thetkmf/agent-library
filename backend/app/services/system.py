"""System information services."""

from __future__ import annotations

import platform
import shutil
from pathlib import Path
from typing import Any

from ..core.config import API_VERSION, Settings
from ..core.paths import build_layout


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


def capabilities(settings: Settings) -> dict[str, Any]:
    """Build the /system/capabilities payload."""
    layout = build_layout(settings)
    usage = shutil.disk_usage(str(_existing_ancestor(layout.data_dir)))
    return {
        "model": {"configured": False, "provider": None, "model": None},
        "vector": {"ready": False, "indexed_items": 0},
        "storage": {"free_bytes": usage.free, "total_bytes": usage.total},
        "privacy": {"allow_external_calls": settings.privacy_allow_external_calls},
    }
