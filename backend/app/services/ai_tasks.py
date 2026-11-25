"""AI automation tasks and suggestions (B8).

- ``POST /ai/tasks`` 先在门禁处判定 Key 与外联开关（409 + 50001 不建任务），再入队；
- 同一时刻只跑一个任务，其余 ``queued``；重启把 ``running`` 置 ``failed``；
- 取消在条目边界生效；
- 任务里的模型调用统一走 ``completion`` 可调用对象，测试注入假模型（零外联）。
"""

from __future__ import annotations

import asyncio
import json
import re
import threading
from collections.abc import Callable, Sequence
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from ..core.config import Settings
from ..core.errors import AppError, ErrorCode, not_found, unsupported_query
from ..core.ids import new_id
from ..core.logging import get_logger
from ..db.base import utcnow
from ..db.models import AiSuggestion, AiTask, GraphEdge, GraphNode, Item, Tag, UserProfile
from ..repositories import items as items_repo
from ..schemas.ai import (
    AiTaskCreate,
    AiTaskOut,
    AiTaskPage,
    ProfileOut,
    SuggestionOut,
    SuggestionPage,
)
from .llm import DeepSeekClient, ensure_model_ready, resolve_api_key

logger = get_logger("pkb.ai")

PROFILE_ID = "default"
MAX_ITEM_CHARS = 1500
Completion = Callable[[list[dict[str, Any]]], str]

_SUMMARY_PROMPT = (
    "用不超过 120 个汉字总结下面的笔记，只输出 JSON："
    '{{"summary": "..."}}\n\n标题：{title}\n正文：{content}'
)
_TAGS_PROMPT = (
    "为下面的笔记推荐 1-5 个中文标签，只输出 JSON："
    '{{"tags": ["标签"]}}\n\n标题：{title}\n正文：{content}'
)
_LINK_PROMPT = (
    "在候选列表里找出与当前笔记最相关的条目（最多 3 个），只输出 JSON："
    '{{"links": [{{"target_item_id": "...", "reason": "..."}}]}}\n'
    "候选：{candidates}\n当前标题：{title}\n当前正文：{content}"
)
_PROFILE_PROMPT = (
    "根据用户的笔记标题与标签，归纳用户画像，只输出 JSON："
    '{{"interests": ["..."], "knowledge_domains": [{{"domain": "...", "level": "入门"}}], '
    '"learning_goals": ["..."], "preferred_style": "简洁"}}'
    "\n笔记：{items}"
)


def _default_completion_factory(settings: Settings) -> Completion:
    """Build a completion callable that talks to DeepSeek in a worker thread."""

    def complete(messages: list[dict[str, Any]]) -> str:
        async def _run() -> str:
            api_key = resolve_api_key(settings)
            ensure_model_ready(settings, api_key)
            assert api_key is not None
            client = DeepSeekClient(settings, api_key)
            try:
                return await client.acomplete(messages, response_format_json=True)
            finally:
                await client.aclose()

        return asyncio.run(_run())

    return complete


class AiTaskService:
    """Creates and executes AI automation tasks; owns suggestions and the profile."""

    def __init__(
        self,
        settings: Settings,
        session_factory: sessionmaker[Session],
        *,
        completion: Completion | None = None,
        synchronous: bool = False,
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.completion = completion or _default_completion_factory(settings)
        self.synchronous = synchronous
        self._lock = threading.Lock()

    # ---- tasks ------------------------------------------------------
    def create_task(self, payload: AiTaskCreate) -> AiTaskOut:
        if payload.item_ids:
            unique = list(dict.fromkeys(payload.item_ids))
            if len(unique) > 50:
                raise unsupported_query("item_ids 最多 50 个")
            with self.session_factory() as session:
                found = set(session.scalars(select(Item.id).where(Item.id.in_(unique))).all())
                missing = [item_id for item_id in unique if item_id not in found]
            if missing:
                raise AppError(
                    ErrorCode.NOT_FOUND,
                    "条目不存在",
                    http_status=404,
                    data={"missing": missing},
                )
            item_ids = unique
        else:
            item_ids = []
        api_key = resolve_api_key(self.settings)
        ensure_model_ready(self.settings, api_key)

        with self.session_factory() as session:
            task = AiTask(
                type=payload.type,
                status="queued",
                progress=0,
                input_data={"item_ids": item_ids, "options": payload.options},
            )
            session.add(task)
            session.commit()
            session.refresh(task)
            out = _task_out(task)
        self._kick(task.id)
        if self.synchronous:
            return self.get_task(task.id)
        return out

    def list_tasks(
        self,
        *,
        page: int = 1,
        page_size: int = 20,
        status: str | None = None,
        task_type: str | None = None,
    ) -> AiTaskPage:
        if page < 1 or not 1 <= page_size <= 100:
            raise unsupported_query("分页参数超出范围")
        with self.session_factory() as session:
            stmt = select(AiTask)
            count_stmt = select(func.count()).select_from(AiTask)
            if status:
                stmt = stmt.where(AiTask.status == status)
                count_stmt = count_stmt.where(AiTask.status == status)
            if task_type:
                stmt = stmt.where(AiTask.type == task_type)
                count_stmt = count_stmt.where(AiTask.type == task_type)
            total = int(session.scalar(count_stmt) or 0)
            rows = session.scalars(
                stmt.order_by(AiTask.created_at.desc(), AiTask.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
            items = [_task_out(row) for row in rows]
        return AiTaskPage(
            items=items,
            page=page,
            page_size=page_size,
            total=total,
            has_more=page * page_size < total,
        )

    def get_task(self, task_id: str) -> AiTaskOut:
        with self.session_factory() as session:
            task = session.get(AiTask, task_id)
            if task is None:
                raise not_found("任务不存在")
            return _task_out(task)

    def cancel_task(self, task_id: str) -> AiTaskOut:
        with self.session_factory() as session:
            task = session.get(AiTask, task_id)
            if task is None:
                raise not_found("任务不存在")
            if task.status not in ("queued", "running"):
                raise AppError(
                    ErrorCode.ALREADY_EXISTS,
                    "任务已结束，无法取消",
                    http_status=409,
                    data=_task_out(task).model_dump(mode="json"),
                )
            task.status = "canceled"
            task.finished_at = utcnow()
            session.commit()
            session.refresh(task)
            return _task_out(task)

    def recover_interrupted(self) -> int:
        """Mark tasks left running by a previous process as failed."""
        with self.session_factory() as session:
            rows = session.scalars(
                select(AiTask).where(AiTask.status.in_(("running", "queued")))
            ).all()
            for task in rows:
                if task.type == "reindex":  # 索引任务由 IndexService 自己恢复
                    continue
                task.status = "failed"
                task.error_data = {
                    "code": int(ErrorCode.MODEL_CALL_FAILED),
                    "reason": "interrupted",
                }
                task.finished_at = utcnow()
            session.commit()
            return len(rows)

    def _kick(self, task_id: str) -> None:
        if self.synchronous:
            self.run_task(task_id)
            return
        thread = threading.Thread(
            target=self._drain_queue, kwargs={"task_id": task_id}, daemon=True
        )
        thread.start()

    def _drain_queue(self, task_id: str) -> None:
        with self._lock:
            self.run_task(task_id)

    def run_task(self, task_id: str) -> None:
        """Execute one queued task; no-op when it was canceled meanwhile."""
        with self.session_factory() as session:
            task = session.get(AiTask, task_id)
            if task is None or task.status != "queued":
                return
            task.status = "running"
            task.started_at = utcnow()
            task.progress = 5
            session.commit()
            task_type = task.type
            input_data = dict(task.input_data or {})

        try:
            result = self._dispatch(task_id, task_type, input_data)
        except AppError as exc:
            self._finish(task_id, None, {"code": int(exc.code), "message": exc.message})
            return
        except Exception as exc:  # pragma: no cover - 未预期异常也要落状态
            logger.warning("ai.task_failed", extra={"fields": {"reason": type(exc).__name__}})
            self._finish(task_id, None, {"code": int(ErrorCode.UNKNOWN), "message": "任务执行失败"})
            return
        self._finish(task_id, result, None)

    def _finish(
        self, task_id: str, result: dict[str, Any] | None, error: dict[str, Any] | None
    ) -> None:
        with self.session_factory() as session:
            task = session.get(AiTask, task_id)
            if task is None:
                return
            if task.status == "canceled":
                return
            task.status = "failed" if error else "succeeded"
            task.result_data = result
            task.error_data = error
            task.progress = 100
            task.finished_at = utcnow()
            session.commit()

    def _canceled(self, task_id: str) -> bool:
        with self.session_factory() as session:
            task = session.get(AiTask, task_id)
            return task is None or task.status == "canceled"

    def _set_progress(self, task_id: str, progress: int) -> None:
        with self.session_factory() as session:
            task = session.get(AiTask, task_id)
            if task is not None and task.status == "running":
                task.progress = max(0, min(99, progress))
                session.commit()

    def _dispatch(self, task_id: str, task_type: str, input_data: dict[str, Any]) -> dict[str, Any]:
        item_ids = list(input_data.get("item_ids") or [])
        if task_type == "summarize":
            updated, failures = self._summarize(task_id, item_ids)
            return {"updated_items": updated, "failures": failures}
        if task_type == "tagging":
            return {"suggestions_created": self._tagging(task_id, item_ids)}
        if task_type == "linking":
            return {"suggestions_created": self._linking(task_id, item_ids)}
        if task_type == "organize":
            updated, failures = self._summarize(task_id, item_ids)
            created = self._tagging(task_id, item_ids) + self._linking(task_id, item_ids)
            return {
                "suggestions_created": created,
                "summaries_created": updated,
                "failures": failures,
            }
        if task_type == "profile_refresh":
            return {"profile_updated": self._refresh_profile(task_id)}
        if task_type == "graph_build":
            return self._build_graph(task_id)
        raise unsupported_query(f"不支持的任务类型：{task_type}")

    # ---- item selection --------------------------------------------
    def _target_items(self, item_ids: Sequence[str], *, limit: int = 20) -> list[Item]:
        with self.session_factory() as session:
            stmt = select(Item).where(Item.deleted_at.is_(None), Item.status == "active")
            if item_ids:
                stmt = stmt.where(Item.id.in_(list(item_ids)))
            else:
                stmt = stmt.where(Item.type.in_(("note", "tex")))
            rows = session.scalars(stmt.order_by(Item.updated_at.desc()).limit(limit)).all()
            for row in rows:
                _ = row.tags
            return list(rows)

    # ---- task handlers ---------------------------------------------
    def _summarize(self, task_id: str, item_ids: Sequence[str]) -> tuple[int, list[dict[str, Any]]]:
        items = self._target_items(item_ids)
        updated = 0
        failures: list[dict[str, Any]] = []
        for position, item in enumerate(items, start=1):
            if self._canceled(task_id):
                break
            payload = self._ask_json(
                _SUMMARY_PROMPT.format(title=item.title, content=_clip(item.content))
            )
            summary = payload.get("summary") if isinstance(payload, dict) else None
            if not isinstance(summary, str) or not summary.strip():
                failures.append({"item_id": item.id, "reason": "invalid_model_output"})
            else:
                with self.session_factory() as session:
                    row = session.get(Item, item.id)
                    if row is not None:
                        row.ai_summary = summary.strip()[:2000]
                        row.updated_at = utcnow()
                        session.commit()
                updated += 1
            self._set_progress(task_id, 5 + int(position * 90 / max(len(items), 1)))
        return updated, failures

    def _tagging(self, task_id: str, item_ids: Sequence[str]) -> int:
        items = self._target_items(item_ids)
        created = 0
        for position, item in enumerate(items, start=1):
            if self._canceled(task_id):
                break
            payload = self._ask_json(
                _TAGS_PROMPT.format(title=item.title, content=_clip(item.content))
            )
            tags = payload.get("tags") if isinstance(payload, dict) else None
            names = [str(name).strip() for name in tags or [] if str(name).strip()][:5]
            if names:
                created += self._add_suggestion(
                    "tag", item.id, {"tags": list(dict.fromkeys(names))}
                )
            self._set_progress(task_id, 5 + int(position * 90 / max(len(items), 1)))
        return created

    def _linking(self, task_id: str, item_ids: Sequence[str]) -> int:
        items = self._target_items(item_ids)
        created = 0
        with self.session_factory() as session:
            catalog = session.scalars(
                select(Item)
                .where(Item.deleted_at.is_(None), Item.status == "active")
                .order_by(Item.updated_at.desc())
                .limit(30)
            ).all()
            catalogue_text = "\n".join(f"- id={row.id} 标题={row.title}" for row in catalog)
            valid_ids = {row.id for row in catalog}
        for position, item in enumerate(items, start=1):
            if self._canceled(task_id):
                break
            payload = self._ask_json(
                _LINK_PROMPT.format(
                    candidates=catalogue_text, title=item.title, content=_clip(item.content)
                )
            )
            links = payload.get("links") if isinstance(payload, dict) else None
            applied = 0
            for link in links or []:
                if not isinstance(link, dict):
                    continue
                target = str(link.get("target_item_id") or "")
                if target not in valid_ids or target == item.id:
                    continue
                reason = str(link.get("reason") or "")[:200]
                applied += self._add_suggestion(
                    "link",
                    item.id,
                    {"target_item_id": target, "relation": "related_to", "reason": reason},
                )
                if applied >= 3:
                    break
            created += applied
            self._set_progress(task_id, 5 + int(position * 90 / max(len(items), 1)))
        return created

    def _refresh_profile(self, task_id: str) -> bool:
        items = self._target_items([], limit=30)
        lines = []
        for item in items:
            tags = "、".join(tag.name for tag in item.tags)
            lines.append(f"- {item.title}（{tags}）")
        payload = self._ask_json(_PROFILE_PROMPT.format(items="\n".join(lines) or "（暂无笔记）"))
        if not isinstance(payload, dict):
            return False
        with self.session_factory() as session:
            profile = session.get(UserProfile, PROFILE_ID)
            if profile is None:
                profile = UserProfile(id=PROFILE_ID)
                session.add(profile)
            profile.interests = _string_list(payload.get("interests"))
            profile.learning_goals = _string_list(payload.get("learning_goals"))
            domains = payload.get("knowledge_domains")
            profile.knowledge_domains = [
                {str(key): value for key, value in domain.items()}
                for domain in domains or []
                if isinstance(domain, dict)
            ]
            style = payload.get("preferred_style")
            profile.preferred_style = str(style)[:100] if isinstance(style, str) else None
            profile.updated_at = utcnow()
            session.commit()
        self._set_progress(task_id, 95)
        return True

    def _build_graph(self, task_id: str) -> dict[str, int]:
        """Deterministic graph: item/tag nodes + tagged_with and accepted related_to edges.

        分两步：先建立/更新全部节点并 flush（保证边引用的 FK 目标已落库），再写边，
        否则 SQLite 外键会在首次建图时直接报 ``FOREIGN KEY constraint failed``。
        """
        self._set_progress(task_id, 20)
        with self.session_factory() as session:
            item_rows = session.scalars(
                select(Item).where(Item.deleted_at.is_(None), Item.status == "active")
            ).all()
            existing_items = {
                node.item_id: node
                for node in session.scalars(select(GraphNode).where(GraphNode.type == "item")).all()
                if node.item_id
            }
            existing_tags = {
                node.label: node
                for node in session.scalars(select(GraphNode).where(GraphNode.type == "tag")).all()
            }

            def item_node(item: Item) -> GraphNode:
                node = existing_items.get(item.id)
                if node is None:
                    node = GraphNode(
                        id=new_id(), label=item.title[:200], type="item", item_id=item.id
                    )
                    session.add(node)
                    existing_items[item.id] = node
                else:
                    node.label = item.title[:200]
                return node

            def tag_node(name: str) -> GraphNode:
                node = existing_tags.get(name)
                if node is None:
                    node = GraphNode(id=new_id(), label=name[:200], type="tag")
                    session.add(node)
                    existing_tags[name] = node
                return node

            pairs: list[tuple[GraphNode, GraphNode]] = []
            for item in item_rows:
                source = item_node(item)
                for tag in item.tags:
                    pairs.append((source, tag_node(tag.name)))
            session.flush()  # 节点必须先落库，边才可能通过外键校验

            existing_edges = {
                (edge.source_id, edge.target_id, edge.relation)
                for edge in session.scalars(select(GraphEdge)).all()
            }
            for source, target in pairs:
                key = (source.id, target.id, "tagged_with")
                if key in existing_edges:
                    continue
                session.add(
                    GraphEdge(
                        id=new_id(),
                        source_id=source.id,
                        target_id=target.id,
                        relation="tagged_with",
                        weight=1.0,
                    )
                )
                existing_edges.add(key)
            session.flush()

            accepted = session.scalars(
                select(AiSuggestion).where(
                    AiSuggestion.type == "link", AiSuggestion.status == "accepted"
                )
            ).all()
            for suggestion in accepted:
                payload = suggestion.payload or {}
                target_id = str(payload.get("target_item_id") or "")
                source_item = session.get(Item, suggestion.item_id)
                target_item = session.get(Item, target_id)
                if source_item is None or target_item is None:
                    continue
                source_node = item_node(source_item)
                target_node = item_node(target_item)
                relation = str(payload.get("relation") or "related_to")
                key = (source_node.id, target_node.id, relation)
                if key in existing_edges:
                    continue
                session.add(
                    GraphEdge(
                        id=new_id(),
                        source_id=source_node.id,
                        target_id=target_node.id,
                        relation=relation,
                        weight=0.6,
                    )
                )
                existing_edges.add(key)
            session.commit()
            nodes = int(session.scalar(select(func.count()).select_from(GraphNode)) or 0)
            edges = int(session.scalar(select(func.count()).select_from(GraphEdge)) or 0)
        self._set_progress(task_id, 95)
        return {"nodes": nodes, "edges": edges}

    # ---- suggestions -----------------------------------------------
    def _add_suggestion(self, kind: str, item_id: str, payload: dict[str, Any]) -> int:
        """Create a pending suggestion unless an identical one already exists."""
        with self.session_factory() as session:
            existing = session.scalars(
                select(AiSuggestion).where(
                    AiSuggestion.type == kind,
                    AiSuggestion.item_id == item_id,
                    AiSuggestion.status.in_(("pending", "accepted")),
                )
            ).all()
            for row in existing:
                if row.payload == payload:
                    return 0
            session.add(AiSuggestion(type=kind, item_id=item_id, payload=payload))
            session.commit()
        return 1

    def list_suggestions(
        self,
        *,
        page: int = 1,
        page_size: int = 20,
        status: str | None = None,
        kind: str | None = None,
        item_id: str | None = None,
    ) -> SuggestionPage:
        if page < 1 or not 1 <= page_size <= 100:
            raise unsupported_query("分页参数超出范围")
        with self.session_factory() as session:
            stmt = select(AiSuggestion)
            count_stmt = select(func.count()).select_from(AiSuggestion)
            for column, value in (
                (AiSuggestion.status, status),
                (AiSuggestion.type, kind),
                (AiSuggestion.item_id, item_id),
            ):
                if value:
                    stmt = stmt.where(column == value)
                    count_stmt = count_stmt.where(column == value)
            total = int(session.scalar(count_stmt) or 0)
            rows = session.scalars(
                stmt.order_by(AiSuggestion.created_at.desc(), AiSuggestion.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).all()
            items = [_suggestion_out(row) for row in rows]
        return SuggestionPage(
            items=items,
            page=page,
            page_size=page_size,
            total=total,
            has_more=page * page_size < total,
        )

    def accept_suggestion(self, suggestion_id: str) -> SuggestionOut:
        with self.session_factory() as session:
            suggestion = session.get(AiSuggestion, suggestion_id)
            if suggestion is None:
                raise not_found("建议不存在")
            if suggestion.status == "rejected":
                raise AppError(
                    ErrorCode.ALREADY_EXISTS,
                    "建议已被拒绝，无法采纳",
                    http_status=409,
                    data=_suggestion_out(suggestion).model_dump(mode="json"),
                )
            if suggestion.status == "accepted":
                return _suggestion_out(suggestion)
            item = session.get(Item, suggestion.item_id)
            if item is None:
                raise not_found("条目不存在")
            self._apply_suggestion(session, suggestion, item)
            suggestion.status = "accepted"
            suggestion.decided_at = utcnow()
            session.commit()
            session.refresh(suggestion)
            return _suggestion_out(suggestion)

    def reject_suggestion(self, suggestion_id: str) -> SuggestionOut:
        with self.session_factory() as session:
            suggestion = session.get(AiSuggestion, suggestion_id)
            if suggestion is None:
                raise not_found("建议不存在")
            if suggestion.status == "accepted":
                raise AppError(
                    ErrorCode.ALREADY_EXISTS,
                    "建议已被采纳，无法拒绝",
                    http_status=409,
                    data=_suggestion_out(suggestion).model_dump(mode="json"),
                )
            if suggestion.status == "rejected":
                return _suggestion_out(suggestion)
            suggestion.status = "rejected"
            suggestion.decided_at = utcnow()
            session.commit()
            session.refresh(suggestion)
            return _suggestion_out(suggestion)

    def _apply_suggestion(self, session: Session, suggestion: AiSuggestion, item: Item) -> None:
        payload = suggestion.payload or {}
        if suggestion.type == "tag":
            names = [str(name).strip() for name in payload.get("tags") or [] if str(name).strip()]
            if names:
                item.tags = _ensure_tags(session, item, names)
                item.updated_at = utcnow()
            return
        if suggestion.type == "summary":
            summary = payload.get("summary")
            if isinstance(summary, str) and summary.strip():
                item.ai_summary = summary.strip()[:2000]
                item.updated_at = utcnow()
            return
        if suggestion.type == "link":
            target_id = str(payload.get("target_item_id") or "")
            target = session.get(Item, target_id)
            if target is None:
                raise not_found("关联目标不存在")
            source_node = _ensure_item_node(session, item)
            target_node = _ensure_item_node(session, target)
            relation = str(payload.get("relation") or "related_to")
            exists = session.scalar(
                select(func.count())
                .select_from(GraphEdge)
                .where(
                    GraphEdge.source_id == source_node.id,
                    GraphEdge.target_id == target_node.id,
                    GraphEdge.relation == relation,
                )
            )
            if not exists:
                session.add(
                    GraphEdge(
                        id=new_id(),
                        source_id=source_node.id,
                        target_id=target_node.id,
                        relation=relation,
                        weight=1.0,
                    )
                )

    # ---- profile ----------------------------------------------------
    def get_profile(self) -> ProfileOut:
        with self.session_factory() as session:
            profile = session.get(UserProfile, PROFILE_ID)
            if profile is None:
                return ProfileOut()
            return ProfileOut(
                interests=list(profile.interests or []),
                knowledge_domains=list(profile.knowledge_domains or []),
                learning_goals=list(profile.learning_goals or []),
                preferred_style=profile.preferred_style,
                updated_at=profile.updated_at,
            )

    def refresh_profile(self) -> AiTaskOut:
        return self.create_task(AiTaskCreate(type="profile_refresh"))

    # ---- helpers ----------------------------------------------------
    def _ask_json(self, prompt: str) -> dict[str, Any]:
        raw = self.completion(
            [
                {"role": "system", "content": "你是知识整理助手，只输出严格 JSON，不要解释。"},
                {"role": "user", "content": prompt},
            ]
        )
        return _parse_json_object(raw)


def _clip(content: str | None) -> str:
    text = (content or "").strip()
    return text[:MAX_ITEM_CHARS]


def _parse_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.S)
        if match is None:
            return {}
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return {}
    return parsed if isinstance(parsed, dict) else {}


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item)[:100] for item in value if str(item).strip()][:50]


def _ensure_tags(session: Session, item: Item, names: Sequence[str]) -> list[Tag]:
    tags = {tag.name.casefold(): tag for tag in item.tags}
    output = list(item.tags)
    for name in names:
        key = name.casefold()
        if key in tags:
            continue
        tag = items_repo.find_tag_by_casefold(session, name)
        if tag is None:
            tag = Tag(id=new_id(), name=name[:50])
            session.add(tag)
            session.flush()
        tags[key] = tag
        output.append(tag)
    return output


def _ensure_item_node(session: Session, item: Item) -> GraphNode:
    node = session.scalar(
        select(GraphNode).where(GraphNode.type == "item", GraphNode.item_id == item.id)
    )
    if node is None:
        node = GraphNode(id=new_id(), label=item.title[:200], type="item", item_id=item.id)
        session.add(node)
        session.flush()
    return node


def _task_out(task: AiTask) -> AiTaskOut:
    return AiTaskOut(
        id=task.id,
        type=task.type,
        status=task.status,
        progress=task.progress,
        input=dict(task.input_data or {}),
        result=dict(task.result_data) if task.result_data else None,
        error=dict(task.error_data) if task.error_data else None,
        started_at=task.started_at,
        finished_at=task.finished_at,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _suggestion_out(suggestion: AiSuggestion) -> SuggestionOut:
    return SuggestionOut(
        id=suggestion.id,
        type=suggestion.type,
        item_id=suggestion.item_id,
        payload=dict(suggestion.payload or {}),
        status=suggestion.status,
        created_at=suggestion.created_at,
        decided_at=suggestion.decided_at,
    )
