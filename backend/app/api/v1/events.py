"""Server-sent events stream (§9.7, B9)."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from ...schemas.common import ErrorEnvelope
from ...services.events import EventBus
from ..deps import require_token

router = APIRouter(prefix="/events", tags=["events"], dependencies=[Depends(require_token)])

HEARTBEAT_SECONDS = 15.0


@router.get(
    "/stream",
    responses={
        200: {"content": {"text/event-stream": {}}, "description": "SSE 事件流"},
        401: {"model": ErrorEnvelope, "description": "未认证"},
    },
    summary="系统事件流（reminder.due 等；不重放历史）",
)
async def stream(request: Request) -> StreamingResponse:
    """Subscribe to in-process events; 15s heartbeat comments keep the socket alive."""
    bus: EventBus = request.app.state.event_bus
    return StreamingResponse(
        _events(bus, request.is_disconnected),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _events(
    bus: EventBus, is_disconnected: Any, heartbeat: float = HEARTBEAT_SECONDS
) -> AsyncIterator[str]:
    queue = bus.subscribe()
    try:
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=heartbeat)
            except TimeoutError:
                if await is_disconnected():
                    break
                yield ": ping\n\n"
                continue
            if await is_disconnected():
                break
            payload = json.dumps(message.data, ensure_ascii=False)
            yield f"event: {message.event}\ndata: {payload}\n\n"
    finally:
        bus.unsubscribe(queue)
