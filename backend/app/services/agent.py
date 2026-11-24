"""Agent conversations and streaming chat (B7-1…B7-4).

对话编排：会话持久化 + DeepSeek 流式 + 只读工具循环 + citations。
任何外联都必须先通过 ``ensure_model_ready``（Key + 显式外联开关），否则 409 + 50001。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from ..core.config import Settings
from ..core.errors import AppError, ErrorCode, not_found, unsupported_query
from ..core.ids import new_id
from ..core.logging import get_logger
from ..db.base import utcnow
from ..db.models import Conversation, Item, Message
from ..schemas.agent import (
    ChatRequest,
    ConversationDetail,
    ConversationPage,
    ConversationSummary,
    MessageOut,
)
from .agent_tools import TOOL_SPECS, ToolRunner, dedupe_citations
from .llm import (
    DeepSeekClient,
    StreamChunk,
    ToolCall,
    ensure_model_ready,
    merge_tool_calls,
    resolve_api_key,
)
from .search import SearchService

logger = get_logger("pkb.agent")

ClientFactory = Callable[[Settings, str], DeepSeekClient]
DEFAULT_TITLE_LENGTH = 30


@dataclass(slots=True)
class ChatEvent:
    """One SSE event to emit."""

    event: str
    data: dict[str, Any]


@dataclass(slots=True)
class PreparedChat:
    """Everything resolved before the stream starts."""

    conversation_id: str
    assistant_id: str
    messages: list[dict[str, Any]]
    user_content: str
    api_key: str = field(repr=False)


def _default_client_factory(settings: Settings, api_key: str) -> DeepSeekClient:
    return DeepSeekClient(settings, api_key)


class AgentService:
    """Owns conversations and the streaming chat pipeline."""

    def __init__(
        self,
        settings: Settings,
        session_factory: sessionmaker[Session],
        search_service: SearchService,
        client_factory: ClientFactory = _default_client_factory,
        tool_runner: ToolRunner | None = None,
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.search_service = search_service
        self.client_factory = client_factory
        self.tools = tool_runner or ToolRunner(settings, session_factory, search_service)

    # ---- conversations (B7-1) ---------------------------------------
    def list_conversations(self, *, page: int = 1, page_size: int = 20) -> ConversationPage:
        if page < 1 or not 1 <= page_size <= 100:
            raise unsupported_query("分页参数超出范围")
        with self.session_factory() as session:
            total = session.scalar(select(func.count()).select_from(Conversation)) or 0
            rows = session.scalars(
                select(Conversation)
                .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
            counts = _message_counts(session, [row.id for row in rows])
            items = [_summary(row, counts.get(row.id, 0)) for row in rows]
        return ConversationPage(
            items=items,
            page=page,
            page_size=page_size,
            total=int(total),
            has_more=page * page_size < int(total),
        )

    def get_conversation(self, conversation_id: str) -> ConversationDetail:
        with self.session_factory() as session:
            conversation = session.get(Conversation, conversation_id)
            if conversation is None:
                raise not_found("会话不存在")
            messages = session.scalars(
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.created_at.asc(), Message.id.asc())
            ).all()
            detail = ConversationDetail(
                **_summary(conversation, len(messages)).model_dump(),
                messages=[
                    MessageOut.model_validate(message, from_attributes=True) for message in messages
                ],
            )
        return detail

    def delete_conversation(self, conversation_id: str) -> None:
        with self.session_factory() as session:
            conversation = session.get(Conversation, conversation_id)
            if conversation is None:
                raise not_found("会话不存在")
            session.delete(conversation)
            session.commit()

    # ---- chat (B7-2 / B7-3) -----------------------------------------
    def prepare(self, payload: ChatRequest) -> PreparedChat:
        """Validate everything that must fail before the SSE stream opens."""
        if not payload.stream:
            raise unsupported_query("仅支持 stream=true")
        last = payload.messages[-1]
        if last.role != "user":
            raise unsupported_query("最后一条消息必须是 user")
        api_key = resolve_api_key(self.settings)
        ensure_model_ready(self.settings, api_key)
        assert api_key is not None  # ensure_model_ready 已保证

        with self.session_factory() as session:
            conversation: Conversation | None = None
            if payload.conversation_id:
                conversation = session.get(Conversation, payload.conversation_id)
                if conversation is None:
                    raise not_found("会话不存在")
            else:
                conversation = Conversation(
                    id=new_id(), title=last.content.strip()[:DEFAULT_TITLE_LENGTH]
                )
                session.add(conversation)
                session.commit()
                session.refresh(conversation)
            conversation_id = conversation.id
            history = self._history(session, conversation_id)
            context_messages = self._context_messages(session, payload.context_item_ids)

        messages: list[dict[str, Any]] = [{"role": "system", "content": _SYSTEM_PROMPT}]
        messages.extend(context_messages)
        messages.extend(history)
        return PreparedChat(
            conversation_id=conversation_id,
            assistant_id=new_id(),
            messages=messages,
            user_content=last.content,
            api_key=api_key,
        )

    async def stream(self, prepared: PreparedChat) -> AsyncIterator[ChatEvent]:
        """Stream events for one chat turn; persists only on success."""
        client = self.client_factory(self.settings, prepared.api_key)
        yield ChatEvent(
            "message.started",
            {"conversation_id": prepared.conversation_id, "message_id": prepared.assistant_id},
        )
        messages = [*prepared.messages, {"role": "user", "content": prepared.user_content}]
        collected: list[dict[str, Any]] = []
        citations: list[dict[str, Any]] = []
        tool_calling = False
        finish_reason = "stop"
        text_parts: list[str] = []
        try:
            for _round in range(self.settings.agent_tool_rounds):
                round_text: list[str] = []
                deltas: list[Any] = []
                round_finish: str | None = None
                async for chunk in client.astream(messages, tools=TOOL_SPECS):
                    async for event in self._emit_chunk(chunk, round_text, deltas):
                        yield event
                    if chunk.finish_reason:
                        round_finish = chunk.finish_reason
                text_parts.extend(round_text)
                calls = merge_tool_calls(deltas)
                if not calls:
                    finish_reason = round_finish or "stop"
                    break
                tool_calling = True
                messages.append(_assistant_tool_message(round_text, calls))
                for index, call in enumerate(calls):
                    outcome = await asyncio.to_thread(self.tools.run, call.name, call.arguments)
                    collected.append(
                        {
                            "name": call.name,
                            "arguments": call.arguments,
                            "result": outcome.payload,
                        }
                    )
                    citations.extend(outcome.citations)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.call_id or f"call_{index}",
                            "content": json.dumps(outcome.payload, ensure_ascii=False),
                        }
                    )
            content = "".join(text_parts)
            unique_citations = dedupe_citations(citations, self.settings.agent_max_citations)
            self._persist(prepared, content, unique_citations, collected)
        except AppError as exc:
            yield ChatEvent(
                "error",
                {"code": int(exc.code), "message": exc.message, "data": exc.data},
            )
            return
        finally:
            await client.aclose()

        yield ChatEvent(
            "message.completed",
            {
                "message_id": prepared.assistant_id,
                "finish_reason": finish_reason,
                "citations": unique_citations,
                "tool_calling": tool_calling,
            },
        )

    async def _emit_chunk(
        self, chunk: StreamChunk, round_text: list[str], deltas: list[Any]
    ) -> AsyncIterator[ChatEvent]:
        if chunk.content:
            round_text.append(chunk.content)
            yield ChatEvent("message.delta", {"delta": chunk.content})
        deltas.extend(chunk.tool_calls)

    # ---- persistence ------------------------------------------------
    def _persist(
        self,
        prepared: PreparedChat,
        content: str,
        citations: list[dict[str, Any]],
        tool_calls: list[dict[str, Any]],
    ) -> None:
        with self.session_factory() as session:
            conversation = session.get(Conversation, prepared.conversation_id)
            if conversation is None:  # 会话在生成期间被删除：不写消息
                return
            session.add(
                Message(
                    conversation_id=conversation.id,
                    role="user",
                    content=prepared.user_content,
                )
            )
            session.add(
                Message(
                    id=prepared.assistant_id,
                    conversation_id=conversation.id,
                    role="assistant",
                    content=content,
                    citations=citations,
                    tool_calls=tool_calls,
                )
            )
            conversation.updated_at = utcnow()
            session.commit()

    def _history(self, session: Session, conversation_id: str) -> list[dict[str, Any]]:
        rows = session.scalars(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.asc(), Message.id.asc())
        ).all()
        limit = self.settings.agent_history_messages
        trimmed = rows[-limit:]
        return [{"role": row.role, "content": row.content} for row in trimmed]

    def _context_messages(
        self, session: Session, context_item_ids: Sequence[str]
    ) -> list[dict[str, Any]]:
        if not context_item_ids:
            return []
        unique_ids = list(dict.fromkeys(context_item_ids))
        if len(unique_ids) > self.settings.agent_max_context_items:
            raise unsupported_query(
                f"context_item_ids 最多 {self.settings.agent_max_context_items} 个"
            )
        rows = session.scalars(select(Item).where(Item.id.in_(unique_ids))).all()
        found = {row.id: row for row in rows if row.deleted_at is None}
        missing = [item_id for item_id in unique_ids if item_id not in found]
        if missing:
            raise AppError(
                ErrorCode.NOT_FOUND,
                "上下文条目不存在",
                http_status=404,
                details={"missing": missing},
            )
        lines = [
            f"- {found[item_id].title}（{found[item_id].type}，id={item_id}）"
            for item_id in unique_ids
        ]
        return [
            {
                "role": "system",
                "content": "用户本轮引用了以下条目，请优先结合它们回答：\n" + "\n".join(lines),
            }
        ]


_SYSTEM_PROMPT = (
    "你是用户个人知识库的助手。回答要简洁、可核查，优先使用 search_knowledge 检索用户自己的资料；"
    "引用资料时说明条目标题，不要编造不存在的条目或数据。"
    "需要条目原文时用 get_item_content，需要元信息时用 get_item。"
)


def _assistant_tool_message(round_text: list[str], calls: Sequence[ToolCall]) -> dict[str, Any]:
    return {
        "role": "assistant",
        "content": "".join(round_text),
        "tool_calls": [
            {
                "id": call.call_id or f"call_{index}",
                "type": "function",
                "function": {"name": call.name, "arguments": call.arguments},
            }
            for index, call in enumerate(calls)
        ],
    }


def _message_counts(session: Session, conversation_ids: Sequence[str]) -> dict[str, int]:
    if not conversation_ids:
        return {}
    rows = session.execute(
        select(Message.conversation_id, func.count())
        .where(Message.conversation_id.in_(conversation_ids))
        .group_by(Message.conversation_id)
    ).all()
    return {str(conversation_id): int(count) for conversation_id, count in rows}


def _summary(conversation: Conversation, message_count: int) -> ConversationSummary:
    return ConversationSummary(
        id=conversation.id,
        title=conversation.title,
        message_count=message_count,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )
