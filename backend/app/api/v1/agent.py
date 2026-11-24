"""Agent endpoints: conversations + SSE chat (§9.6, B7)."""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from ...core.envelope import envelope
from ...schemas.agent import ChatRequest, ConversationDetail, ConversationPage
from ...schemas.common import Envelope, ErrorEnvelope
from ...services.agent import AgentService, ChatEvent
from ..deps import SessionDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "参数不合法"},
    401: {"model": ErrorEnvelope, "description": "未认证"},
    404: {"model": ErrorEnvelope, "description": "会话/上下文条目不存在"},
    409: {"model": ErrorEnvelope, "description": "模型未配置"},
}

router = APIRouter(prefix="/agent", tags=["agent"], dependencies=[Depends(require_token)])


@router.get(
    "/conversations",
    response_model=Envelope[ConversationPage],
    responses=_ERROR_RESPONSES,
    summary="会话列表（updated_at DESC）",
)
def list_conversations(
    request: Request,
    session: SessionDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict[str, Any]:
    """List conversations newest first."""
    _ = session
    service: AgentService = request.app.state.agent_service
    return envelope(service.list_conversations(page=page, page_size=page_size))


@router.get(
    "/conversations/{conversation_id}",
    response_model=Envelope[ConversationDetail],
    responses=_ERROR_RESPONSES,
    summary="会话详情（消息升序）",
)
def get_conversation(request: Request, session: SessionDep, conversation_id: str) -> dict[str, Any]:
    """Return one conversation with its messages."""
    _ = session
    service: AgentService = request.app.state.agent_service
    return envelope(service.get_conversation(conversation_id))


@router.delete(
    "/conversations/{conversation_id}",
    response_model=Envelope[dict[str, str]],
    responses=_ERROR_RESPONSES,
    summary="删除会话（级联消息）",
)
def delete_conversation(
    request: Request, session: SessionDep, conversation_id: str
) -> dict[str, Any]:
    """Hard-delete a conversation and its messages."""
    _ = session
    service: AgentService = request.app.state.agent_service
    service.delete_conversation(conversation_id)
    return envelope({"id": conversation_id})


@router.post(
    "/chat",
    responses={
        200: {"content": {"text/event-stream": {}}, "description": "SSE 事件流"},
        **_ERROR_RESPONSES,
        502: {"model": ErrorEnvelope, "description": "上游模型错误"},
    },
    summary="SSE 流式对话（message.started/delta/completed/error）",
)
async def chat(request: Request, payload: ChatRequest, session: SessionDep) -> StreamingResponse:
    """Stream one chat turn.

    Pre-flight failures return HTTP errors; mid-stream failures emit an `error` event.
    """
    _ = session
    service: AgentService = request.app.state.agent_service
    prepared = service.prepare(payload)
    heartbeat = service.settings.agent_sse_heartbeat_s
    return StreamingResponse(
        _sse_events(service, prepared, request.is_disconnected, heartbeat),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _sse_events(
    service: AgentService,
    prepared: Any,
    is_disconnected: Callable[[], Awaitable[bool]],
    heartbeat: float,
) -> AsyncIterator[str]:
    """Pump service events into SSE with heartbeat comments and disconnect handling."""
    queue: asyncio.Queue[ChatEvent | None] = asyncio.Queue()

    async def pump() -> None:
        try:
            async for event in service.stream(prepared):
                await queue.put(event)
        finally:
            await queue.put(None)

    task = asyncio.create_task(pump())
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=heartbeat)
            except TimeoutError:
                if await is_disconnected():
                    break
                yield ": ping\n\n"
                continue
            if event is None:
                break
            if await is_disconnected():
                break
            yield _format_event(event)
            if event.event in ("message.completed", "error"):
                break
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


def _format_event(event: ChatEvent) -> str:
    data = json.dumps(event.data, ensure_ascii=False)
    return f"event: {event.event}\ndata: {data}\n\n"
