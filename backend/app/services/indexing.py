"""Vector index maintenance: reindex tasks, status and item linkage (§9.5).

Embeddings are only computed inside background reindex tasks; request handlers
just flip ``embedding_status`` so the API stays responsive.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from ..core.config import Settings
from ..core.errors import AppError, ErrorCode
from ..core.logging import get_logger
from ..db.base import utcnow
from ..db.models import AiTask, Item
from .chunking import chunk_text
from .embedding import EmbeddingService
from .text_extraction import extract_item_text
from .vector_store import ChunkRecord, VectorStore

logger = get_logger("pkb.index")

REINDEX = "reindex"
ACTIVE_STATUSES = ("queued", "running")


@dataclass(frozen=True, slots=True)
class IndexStatus:
    """Snapshot returned by GET /index/status."""

    ready: bool
    indexed_count: int
    pending_count: int
    last_updated_at: datetime | None
    embedding_model: str
    embedding_dimension: int
    embedding_status: str
    task_id: str | None
    task_status: str | None
    task_progress: int | None


def chain_text(item: Item, settings: Settings) -> str | None:
    """Expose text extraction through the service for tests and tasks."""
    return extract_item_text(item, settings)


class IndexService:
    """Owns the reindex task lifecycle and the vector store."""

    def __init__(
        self,
        settings: Settings,
        session_factory: sessionmaker[Session],
        store: VectorStore,
        embedder: EmbeddingService,
        *,
        synchronous: bool = False,
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.store = store
        self.embedder = embedder
        self.synchronous = synchronous

    # ---- queries ----------------------------------------------------
    def _active_task(self, session: Session) -> AiTask | None:
        stmt = (
            select(AiTask)
            .where(AiTask.type == REINDEX, AiTask.status.in_(ACTIVE_STATUSES))
            .order_by(AiTask.created_at.desc())
            .limit(1)
        )
        return session.scalars(stmt).first()

    def _last_finished_task(self, session: Session) -> AiTask | None:
        stmt = (
            select(AiTask)
            .where(AiTask.type == REINDEX, AiTask.status == "succeeded")
            .order_by(AiTask.finished_at.desc())
            .limit(1)
        )
        return session.scalars(stmt).first()

    def status(self) -> IndexStatus:
        described = self.embedder.describe()
        with self.session_factory() as session:
            indexed = session.scalar(
                select(func.count())
                .select_from(Item)
                .where(Item.embedding_status == "indexed", Item.deleted_at.is_(None))
            )
            pending = session.scalar(
                select(func.count())
                .select_from(Item)
                .where(
                    Item.embedding_status.in_(("pending", "failed")),
                    Item.deleted_at.is_(None),
                )
            )
            active = self._active_task(session)
            last = self._last_finished_task(session)
        current = active or last
        return IndexStatus(
            ready=described.ready and self.store is not None,
            indexed_count=int(indexed or 0),
            pending_count=int(pending or 0),
            last_updated_at=last.finished_at if last is not None else None,
            embedding_model=described.model,
            embedding_dimension=described.dimension,
            embedding_status=described.status,
            task_id=current.id if current is not None else None,
            task_status=current.status if current is not None else None,
            task_progress=current.progress if current is not None else None,
        )

    # ---- task lifecycle ---------------------------------------------
    def start_reindex(self, mode: str = "incremental") -> AiTask:
        """Queue a reindex task; refuses when embeddings are unavailable."""
        if mode not in ("incremental", "full"):
            raise AppError(ErrorCode.UNSUPPORTED_QUERY, "mode 只支持 incremental 或 full")
        described = self.embedder.describe()
        if not described.ready:
            raise AppError(
                ErrorCode.MODEL_NOT_CONFIGURED,
                "本地嵌入模型尚未就绪，无法重建索引",
                http_status=409,
            )
        with self.session_factory() as session:
            active = self._active_task(session)
            if active is not None:
                raise AppError(
                    ErrorCode.ALREADY_EXISTS,
                    "已有重建任务在执行",
                    http_status=409,
                    data={"id": active.id, "status": active.status, "progress": active.progress},
                )
            task = AiTask(type=REINDEX, status="queued", progress=0, input_data={"mode": mode})
            session.add(task)
            session.commit()
            session.refresh(task)
            task_id = task.id
            snapshot = task
        if self.synchronous:
            self.run_task(task_id)
        else:
            import threading

            threading.Thread(target=self.run_task, args=(task_id,), daemon=True).start()
        return snapshot

    def recover_interrupted(self) -> int:
        """Mark tasks interrupted by a previous shutdown as failed."""
        with self.session_factory() as session:
            rows = session.scalars(
                select(AiTask).where(AiTask.type == REINDEX, AiTask.status.in_(ACTIVE_STATUSES))
            ).all()
            for row in rows:
                row.status = "failed"
                row.progress = min(row.progress, 99)
                row.finished_at = utcnow()
                row.error_data = {
                    "code": int(ErrorCode.EMBEDDING_FAILED),
                    "message": "服务重启，任务中断",
                }
            if rows:
                session.commit()
            return len(rows)

    def _candidate_items(self, session: Session, mode: str) -> list[Item]:
        stmt = select(Item).where(
            Item.deleted_at.is_(None),
            Item.status.in_(("active", "archived")),
            Item.embedding_status != "skipped",
        )
        if mode == "incremental":
            stmt = stmt.where(Item.embedding_status.in_(("pending", "failed")))
        stmt = stmt.order_by(Item.created_at.asc(), Item.id.asc())
        return list(session.scalars(stmt).all())

    def _aborted(self, session: Session, task: AiTask) -> bool:
        session.refresh(task)
        return task.status == "canceled"

    def run_task(self, task_id: str) -> None:
        """Execute one reindex task synchronously (also used by the thread)."""
        with self.session_factory() as session:
            task = session.get(AiTask, task_id)
            if task is None:
                return
            if task.status != "queued":
                return
            task.status = "running"
            task.started_at = utcnow()
            session.commit()
            mode = str(task.input_data.get("mode", "incremental"))
            items = self._candidate_items(session, mode)
            total = len(items)
            failed = 0

            if mode == "full":
                self._prune_orphans(session)

            for position, item in enumerate(items, start=1):
                if self._aborted(session, task):
                    task.finished_at = utcnow()
                    session.commit()
                    logger.info("index.task_canceled")
                    return
                try:
                    self._index_item(session, item)
                except Exception as exc:  # 单个条目失败不影响整体任务
                    failed += 1
                    item.embedding_status = "failed"
                    logger.warning(
                        "index.item_failed",
                        extra={"fields": {"item": item.id, "reason": type(exc).__name__}},
                    )
                task.progress = int(position * 100 / total) if total else 100
                session.commit()

            task.progress = 100
            task.status = "succeeded" if failed == 0 else "failed"
            task.finished_at = utcnow()
            if failed:
                task.error_data = {
                    "code": int(ErrorCode.EMBEDDING_FAILED),
                    "message": f"{failed} 个条目索引失败",
                }
            session.commit()
            logger.info(
                "index.task_finished",
                extra={"fields": {"mode": mode, "items": total, "failed": failed}},
            )

    # ---- helpers ----------------------------------------------------
    def _index_item(self, session: Session, item: Item) -> None:
        text = extract_item_text(item, self.settings)
        if text is None:
            item.embedding_status = "skipped"
            session.commit()
            self.store.delete_item(item.id)
            return
        chunks = chunk_text(
            text,
            chunk_chars=self.settings.chunk_chars,
            overlap_chars=self.settings.chunk_overlap_chars,
            max_chunks=self.settings.chunk_max_per_item,
        )
        if not chunks:
            item.embedding_status = "skipped"
            session.commit()
            self.store.delete_item(item.id)
            return
        vectors = self.embedder.embed_documents([chunk.text for chunk in chunks])
        records = [
            ChunkRecord(
                item_id=item.id,
                chunk_index=chunk.index,
                text=chunk.text,
                embedding=vector,
                model=self.settings.embedding_model,
                dimension=self.settings.embedding_dimension,
            )
            for chunk, vector in zip(chunks, vectors, strict=True)
        ]
        self.store.delete_item(item.id)
        self.store.upsert_item(records)
        item.embedding_status = "indexed"
        session.commit()

    def _prune_orphans(self, session: Session) -> None:
        """Full rebuild: drop vectors of items that no longer exist or are trashed."""
        alive = set(
            session.scalars(
                select(Item.id).where(
                    Item.deleted_at.is_(None), Item.status.in_(("active", "archived"))
                )
            ).all()
        )
        store_item_ids = getattr(self.store, "item_ids", None)
        if store_item_ids is None:
            return
        for item_id in list(store_item_ids()):
            if item_id not in alive:
                self.store.delete_item(item_id)

    @staticmethod
    def task_payload(task: AiTask) -> dict[str, Any]:
        """Shape returned by POST /index/reindex (202)."""
        return {
            "task_id": task.id,
            "type": "reindex",
            "status": task.status,
            "progress": task.progress,
        }
