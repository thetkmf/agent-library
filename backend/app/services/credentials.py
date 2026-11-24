"""DeepSeek API key storage: Windows credential manager only (B12).

Key 永不写库、不进日志：``keyring.set_password(service="pkb-deepseek", username="api_key")``。
凭据后端不可用时退化为进程内字典（仅本次运行有效），方便测试与无凭据环境。
"""

from __future__ import annotations

import contextlib
import importlib
from typing import Any

from ..core.logging import get_logger

logger = get_logger("pkb.credentials")

KEYRING_SERVICE = "pkb-deepseek"
KEYRING_USERNAME = "api_key"

_fallback: dict[str, str] = {}


def _keyring() -> Any | None:
    try:
        return importlib.import_module("keyring")
    except Exception:  # pragma: no cover - keyring 未安装
        return None


def backend_available() -> bool:
    """True when a real credential backend is usable."""
    keyring = _keyring()
    if keyring is None:
        return False
    try:
        keyring.get_password(KEYRING_SERVICE, KEYRING_USERNAME)
    except Exception:  # pragma: no cover - 无可用后端
        return False
    return True


def get_api_key() -> str | None:
    """Return the stored key (never logged, never returned by the API)."""
    keyring = _keyring()
    if keyring is not None:
        try:
            value = keyring.get_password(KEYRING_SERVICE, KEYRING_USERNAME)
            if value:
                return str(value)
        except Exception:  # pragma: no cover - 凭据后端异常
            logger.warning("credentials.read_failed")
    return _fallback.get(KEYRING_USERNAME)


def set_api_key(value: str) -> None:
    """Persist the key; empty input clears it."""
    cleaned = value.strip()
    if not cleaned:
        clear_api_key()
        return
    keyring = _keyring()
    if keyring is not None:
        try:
            keyring.set_password(KEYRING_SERVICE, KEYRING_USERNAME, cleaned)
            return
        except Exception:  # pragma: no cover - 凭据后端写入失败
            logger.warning("credentials.write_failed")
    _fallback[KEYRING_USERNAME] = cleaned


def clear_api_key() -> None:
    """Remove the stored key."""
    keyring = _keyring()
    if keyring is not None:
        with contextlib.suppress(Exception):  # pragma: no cover - 本来就不存在
            keyring.delete_password(KEYRING_SERVICE, KEYRING_USERNAME)
    _fallback.pop(KEYRING_USERNAME, None)


def has_api_key() -> bool:
    """Whether a key is configured (boolean only)."""
    return bool(get_api_key())
