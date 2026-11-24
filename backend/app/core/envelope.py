"""Response envelope helpers shared by routes and exception handlers."""

from __future__ import annotations

from typing import Any

from .context import get_request_id


def envelope(data: Any = None, *, message: str = "ok", code: int = 0) -> dict[str, Any]:
    """Build a success envelope."""
    return {
        "code": code,
        "message": message,
        "data": data,
        "request_id": get_request_id() or "",
    }


def error_envelope(
    code: int, message: str, details: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Build a failure envelope."""
    payload = envelope(None, message=message, code=int(code))
    if details is not None:
        payload["details"] = details
    return payload
