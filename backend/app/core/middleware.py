"""Request id propagation, access logging and request id echo."""

from __future__ import annotations

import time
from typing import Any

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .context import reset_request_id, set_request_id
from .ids import new_id
from .logging import get_logger

logger = get_logger("pkb.access")


class RequestContextMiddleware:
    """Attach a request id to every request and log one access line per request."""

    def __init__(self, app: ASGIApp, slow_request_ms: int = 1000) -> None:
        self.app = app
        self.slow_request_ms = slow_request_ms

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        request_id = (headers.get("x-request-id") or "").strip() or new_id()
        scope.setdefault("state", {})["request_id"] = request_id
        token = set_request_id(request_id)
        started = time.perf_counter()
        status_code = 500

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                MutableHeaders(scope=message)["X-Request-Id"] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 1)
            fields: dict[str, Any] = {
                "method": scope.get("method"),
                "path": scope.get("path"),
                "status": status_code,
                "duration_ms": duration_ms,
            }
            if duration_ms >= self.slow_request_ms:
                logger.warning("http.request", extra={"fields": fields})
            else:
                logger.info("http.request", extra={"fields": fields})
            reset_request_id(token)
