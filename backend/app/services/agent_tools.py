"""Read-only agent tools (B7-3).

v1 只提供只读工具：``search_knowledge``、``get_item``、``get_item_content``、
``list_tags``。写操作与建议生成属于 B8，不在这里实现。
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from ..core.config import Settings
from ..core.errors import AppError
from ..core.logging import get_logger
from ..repositories import items as items_repo
from .search import SearchService

logger = get_logger("pkb.agent.tools")

SEARCH_TOOL = "search_knowledge"
GET_ITEM_TOOL = "get_item"
GET_CONTENT_TOOL = "get_item_content"
LIST_TAGS_TOOL = "list_tags"

TOOL_SPECS: tuple[dict[str, Any], ...] = (
    {
        "type": "function",
        "function": {
            "name": SEARCH_TOOL,
            "description": "检索用户知识库，返回最相关的条目片段（用于回答引用）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "检索关键词或自然语言问题"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5},
                    "mode": {
                        "type": "string",
                        "enum": ["keyword", "semantic", "hybrid"],
                        "default": "hybrid",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": GET_ITEM_TOOL,
            "description": "按 id 读取条目元信息（标题、类型、标签、摘要、时间）。",
            "parameters": {
                "type": "object",
                "properties": {"item_id": {"type": "string"}},
                "required": ["item_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": GET_CONTENT_TOOL,
            "description": "按 id 读取条目正文（笔记/TeX 原文，过长会截断）。",
            "parameters": {
                "type": "object",
                "properties": {"item_id": {"type": "string"}},
                "required": ["item_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": LIST_TAGS_TOOL,
            "description": "列出用户的全部标签及条目数量。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
)


@dataclass(slots=True)
class ToolOutcome:
    """Tool result as fed back to the model plus any citation it produced."""

    payload: dict[str, Any]
    citations: list[dict[str, Any]] = field(default_factory=list)

    def as_message(self) -> dict[str, Any]:
        """Serialise the payload for the tool-role message."""
        return {"content": json.dumps(self.payload, ensure_ascii=False)}


class ToolRunner:
    """Executes tool calls against local services (read-only)."""

    def __init__(
        self,
        settings: Settings,
        session_factory: sessionmaker[Session],
        search_service: SearchService,
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.search_service = search_service

    def run(self, name: str, arguments: str) -> ToolOutcome:
        """Dispatch a tool call; unknown tools and bad arguments return an error payload."""
        try:
            parsed = json.loads(arguments) if arguments.strip() else {}
        except json.JSONDecodeError:
            return ToolOutcome(payload={"error": "参数不是合法 JSON"})
        if not isinstance(parsed, dict):
            return ToolOutcome(payload={"error": "参数必须是对象"})
        try:
            if name == SEARCH_TOOL:
                return self._search(parsed)
            if name == GET_ITEM_TOOL:
                return self._get_item(parsed)
            if name == GET_CONTENT_TOOL:
                return self._get_content(parsed)
            if name == LIST_TAGS_TOOL:
                return self._list_tags()
        except AppError as exc:
            return ToolOutcome(payload={"error": exc.message})
        logger.warning("agent.unknown_tool", extra={"fields": {"tool": name}})
        return ToolOutcome(payload={"error": f"未知工具：{name}"})

    # ---- individual tools -------------------------------------------
    def _search(self, arguments: dict[str, Any]) -> ToolOutcome:
        query = str(arguments.get("query") or "").strip()
        if not query:
            return ToolOutcome(payload={"error": "query 不能为空"})
        limit = _clamp_int(arguments.get("limit"), default=5, low=1, high=10)
        mode = str(arguments.get("mode") or "hybrid")
        result = self.search_service.search(q=query, mode=mode, limit=limit)
        hits: list[dict[str, Any]] = []
        citations: list[dict[str, Any]] = []
        for hit in result.items:
            hits.append(
                {
                    "item_id": hit.item.id,
                    "title": hit.item.title,
                    "type": hit.item.type,
                    "snippet": hit.snippet,
                    "score": round(hit.score, 4),
                }
            )
            citations.append(
                {
                    "item_id": hit.item.id,
                    "title": hit.item.title,
                    "snippet": hit.snippet[:400],
                    "score": round(hit.score, 4),
                }
            )
        return ToolOutcome(
            payload={"query": query, "total": result.total, "results": hits},
            citations=citations,
        )

    def _get_item(self, arguments: dict[str, Any]) -> ToolOutcome:
        item_id = str(arguments.get("item_id") or "").strip()
        with self.session_factory() as session:
            item = items_repo.get_item(session, item_id) if item_id else None
            if item is None or item.deleted_at is not None:
                return ToolOutcome(payload={"error": "条目不存在"})
            payload = {
                "item_id": item.id,
                "type": item.type,
                "title": item.title,
                "preview": item.preview or "",
                "status": item.status,
                "tags": _tag_names(session, item.id),
                "created_at": item.created_at.isoformat(),
                "updated_at": item.updated_at.isoformat(),
            }
            citation = {
                "item_id": item.id,
                "title": item.title,
                "snippet": (item.preview or item.content or "")[:400],
                "score": 1.0,
            }
        return ToolOutcome(payload=payload, citations=[citation])

    def _get_content(self, arguments: dict[str, Any]) -> ToolOutcome:
        item_id = str(arguments.get("item_id") or "").strip()
        with self.session_factory() as session:
            item = items_repo.get_item(session, item_id) if item_id else None
            if item is None or item.deleted_at is not None:
                return ToolOutcome(payload={"error": "条目不存在"})
            if item.type == "file":
                return ToolOutcome(payload={"error": "文件条目没有正文，可用检索片段或条目元信息"})
            content = item.content or ""
            citation = {
                "item_id": item.id,
                "title": item.title,
                "snippet": content[:400],
                "score": 1.0,
            }
        limit = self.settings.agent_tool_content_chars
        truncated = len(content) > limit
        return ToolOutcome(
            payload={
                "item_id": item_id,
                "title": item.title,
                "content": content[:limit],
                "truncated": truncated,
            },
            citations=[citation],
        )

    def _list_tags(self) -> ToolOutcome:
        with self.session_factory() as session:
            from .tags import list_tags

            tags = list_tags(session)
        payload = {"tags": [{"name": tag.name, "item_count": tag.item_count} for tag in tags[:200]]}
        return ToolOutcome(payload=payload)


def _clamp_int(value: Any, *, default: int, low: int, high: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, parsed))


def _tag_names(session: Session, item_id: str) -> list[str]:
    from ..db.models import ItemTag, Tag

    rows = (
        session.query(Tag.name)
        .join(ItemTag, ItemTag.tag_id == Tag.id)
        .filter(ItemTag.item_id == item_id)
    )
    return [name for (name,) in rows.all()]


def citation_key(citation: dict[str, Any]) -> str:
    """Stable dedupe key for citations."""
    return str(citation.get("item_id") or "")


def dedupe_citations(citations: Sequence[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Keep the first citation per item, capped at ``limit``."""
    seen: set[str] = set()
    output: list[dict[str, Any]] = []
    for citation in citations:
        key = citation_key(citation)
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(citation)
        if len(output) >= limit:
            break
    return output
