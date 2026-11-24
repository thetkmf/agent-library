"""Request-scoped context values (request id)."""

from __future__ import annotations

from contextvars import ContextVar, Token

_request_id: ContextVar[str | None] = ContextVar("pkb_request_id", default=None)


def get_request_id() -> str | None:
    """Return the request id bound to the current request, if any."""
    return _request_id.get()


def set_request_id(request_id: str) -> Token[str | None]:
    """Bind a request id to the current context and return the reset token."""
    return _request_id.set(request_id)


def reset_request_id(token: Token[str | None]) -> None:
    """Restore the previous request id value."""
    _request_id.reset(token)
