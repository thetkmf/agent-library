"""Structured JSON logging with lightweight redaction."""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any, Final

from .context import get_request_id

_REDACT_KEYS: Final[frozenset[str]] = frozenset(
    {"token", "authorization", "local_token", "api_key", "apikey", "secret", "password"}
)
_MAX_STRING_LENGTH = 500


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): "***" if str(key).lower() in _REDACT_KEYS else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact(item) for item in value]
    if isinstance(value, str) and len(value) > _MAX_STRING_LENGTH:
        return value[:_MAX_STRING_LENGTH] + "..."
    return value


class JsonFormatter(logging.Formatter):
    """Render a log record as one JSON line."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname,
            "module": record.name,
            "event": record.getMessage(),
            "request_id": get_request_id(),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            payload.update(_redact(fields))
        if record.exc_info:
            payload["error"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO") -> None:
    """Install the JSON formatter on the root logger and let uvicorn reuse it."""
    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def get_logger(name: str = "pkb") -> logging.Logger:
    """Return a namespaced logger."""
    return logging.getLogger(name)
