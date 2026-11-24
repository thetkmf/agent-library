"""Agent conversation and chat payloads (§9.6, B7)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

CHAT_ROLES = ("system", "user", "assistant")


class ChatMessageIn(BaseModel):
    """One inbound chat message."""

    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    """Body of POST /agent/chat."""

    conversation_id: str | None = None
    messages: list[ChatMessageIn] = Field(min_length=1, max_length=50)
    context_item_ids: list[str] = Field(default_factory=list)
    stream: bool = True


class MessageOut(BaseModel):
    """Persisted message."""

    id: str
    role: str
    content: str
    citations: list[dict[str, Any]] = Field(default_factory=list)
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime


class ConversationSummary(BaseModel):
    """Conversation row without messages."""

    id: str
    title: str
    message_count: int = 0
    created_at: datetime
    updated_at: datetime


class ConversationDetail(ConversationSummary):
    """Conversation with its messages in ascending order."""

    messages: list[MessageOut] = Field(default_factory=list)


class ConversationPage(BaseModel):
    """Paginated conversation list."""

    items: list[ConversationSummary] = Field(default_factory=list)
    page: int = 1
    page_size: int = 20
    total: int = 0
    has_more: bool = False


class ChatCompletionInfo(BaseModel):
    """Data of the message.completed SSE event."""

    message_id: str
    finish_reason: str
    citations: list[dict[str, Any]] = Field(default_factory=list)
    tool_calling: bool = False
