"""Keyword / semantic / hybrid search (§9.5, B6).

Keyword search uses the FTS5 mirror (``items_fts``) with a LIKE fallback for short
CJK terms; semantic search queries Chroma through the configured embedder; hybrid
fuses both with Reciprocal Rank Fusion (k=60).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from ..core.config import Settings
from ..core.errors import unsupported_query
from ..core.logging import get_logger
from ..db.models import Item
from ..repositories import search as search_repo
from .embedding import EmbeddingService
from .vector_store import VectorStore

logger = get_logger("pkb.search")

MODES = ("keyword", "semantic", "hybrid")
VALID_TYPES = ("note", "tex", "file")
RRF_K = 60
MAX_QUERY_LENGTH = 200
DEFAULT_LIMIT = 20
MAX_LIMIT = 100


@dataclass(slots=True)
class SearchHit:
    """Internal search hit before projection."""

    item: Item
    score: float
    snippet: str
    match_type: Literal["keyword", "semantic"]


@dataclass(slots=True)
class SearchResult:
    """Result bundle returned by the service."""

    items: list[SearchHit] = field(default_factory=list)
    total: int = 0
    mode: str = "keyword"
    degraded: bool = False


class SearchService:
    """Runs keyword, semantic and hybrid queries against the local index."""

    def __init__(
        self,
        settings: Settings,
        session_factory: sessionmaker[Session],
        store: VectorStore | None,
        embedder: EmbeddingService,
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.store = store
        self.embedder = embedder

    # ---- validation -------------------------------------------------
    def _validate(self, q: str, mode: str, limit: int, types: Sequence[str]) -> str:
        query = q.strip()
        if not 1 <= len(query) <= MAX_QUERY_LENGTH:
            raise unsupported_query(f"q 长度必须在 1 到 {MAX_QUERY_LENGTH} 之间")
        if mode not in MODES:
            raise unsupported_query("mode 只支持 keyword、semantic、hybrid")
        if not 1 <= limit <= MAX_LIMIT:
            raise unsupported_query(f"limit 必须在 1 到 {MAX_LIMIT} 之间")
        if types and not set(types) <= set(VALID_TYPES):
            raise unsupported_query("type 只支持 note、tex、file")
        return query

    # ---- search -----------------------------------------------------
    def search(
        self,
        *,
        q: str,
        mode: str = "hybrid",
        limit: int = DEFAULT_LIMIT,
        types: Sequence[str] | None = None,
        tag_ids: Sequence[str] | None = None,
    ) -> SearchResult:
        query = self._validate(q, mode, limit, types or [])
        type_list = list(types or [])
        tag_list = list(tag_ids or [])
        terms = search_repo.split_terms(query)
        embeddings_ready = self.store is not None and self.embedder.status == "ready"

        effective_mode = mode
        degraded = False
        if mode in ("semantic", "hybrid") and not embeddings_ready:
            effective_mode = "keyword"
            degraded = True

        with self.session_factory() as session:
            keyword_hits = search_repo.keyword_search(
                session,
                terms,
                limit=max(limit * 3, 20),
                types=type_list,
                tag_ids=tag_list,
            )
            semantic_hits: list[tuple[Item, float, str]] = []
            if effective_mode in ("semantic", "hybrid"):
                semantic_hits = self._semantic_hits(
                    session, query, limit=max(limit * 3, 20), types=type_list, tag_ids=tag_list
                )

            if effective_mode == "keyword":
                result = self._keyword_result(keyword_hits, terms, limit)
            elif effective_mode == "semantic":
                result = self._semantic_result(semantic_hits, limit)
            else:
                result = self._hybrid_result(keyword_hits, semantic_hits, terms, limit)

        result.mode = effective_mode
        result.degraded = degraded
        return result

    def _keyword_result(
        self, hits: list[tuple[Item, float]], terms: list[str], limit: int
    ) -> SearchResult:
        output: list[SearchHit] = []
        for item, score in hits:
            output.append(
                SearchHit(
                    item=item,
                    score=min(max(score, 0.0), 1.0),
                    snippet=search_repo.build_snippet(item, terms),
                    match_type="keyword",
                )
            )
        output.sort(key=lambda hit: (-hit.score, hit.item.id))
        total = len(output)
        return SearchResult(items=output[:limit], total=total, mode="keyword")

    def _semantic_result(self, hits: list[tuple[Item, float, str]], limit: int) -> SearchResult:
        output = [
            SearchHit(
                item=item,
                score=min(max(score, 0.0), 1.0),
                snippet=chunk[:400],
                match_type="semantic",
            )
            for item, score, chunk in hits
        ]
        output.sort(key=lambda hit: (-hit.score, hit.item.id))
        return SearchResult(items=output[:limit], total=len(output), mode="semantic")

    def _hybrid_result(
        self,
        keyword_hits: list[tuple[Item, float]],
        semantic_hits: list[tuple[Item, float, str]],
        terms: list[str],
        limit: int,
    ) -> SearchResult:
        fused: dict[str, float] = {}
        items: dict[str, Item] = {}
        kinds: dict[str, str] = {}
        snippets: dict[str, str] = {}

        for rank, (item, _score) in enumerate(keyword_hits, start=1):
            fused[item.id] = fused.get(item.id, 0.0) + 1.0 / (RRF_K + rank)
            items[item.id] = item
            kinds.setdefault(item.id, "keyword")
            snippets.setdefault(item.id, search_repo.build_snippet(item, terms))

        for rank, (item, _score, chunk) in enumerate(semantic_hits, start=1):
            fused[item.id] = fused.get(item.id, 0.0) + 1.0 / (RRF_K + rank)
            items[item.id] = item
            kinds[item.id] = "semantic"
            snippets[item.id] = snippets.get(item.id) or chunk[:400]

        if not fused:
            return SearchResult(items=[], total=0, mode="hybrid")

        top = max(fused.values()) or 1.0
        output = [
            SearchHit(
                item=items[item_id],
                score=min(fused[item_id] / top, 1.0),
                snippet=snippets[item_id],
                match_type="semantic" if kinds[item_id] == "semantic" else "keyword",
            )
            for item_id in fused
        ]
        output.sort(key=lambda hit: (-hit.score, hit.item.id))
        return SearchResult(items=output[:limit], total=len(output), mode="hybrid")

    def _semantic_hits(
        self,
        session: Session,
        query: str,
        *,
        limit: int,
        types: list[str],
        tag_ids: list[str],
    ) -> list[tuple[Item, float, str]]:
        if self.store is None:
            return []
        try:
            vectors = self.embedder.embed_documents([query])
        except Exception as exc:  # 嵌入失败时按降级处理，不让检索报错
            logger.warning("search.embed_failed", extra={"fields": {"reason": type(exc).__name__}})
            return []
        if not vectors:
            return []
        raw_hits = self.store.query(vectors[0], limit=limit)
        allowed = search_repo.filtered_ids(session, types or None, tag_ids or None)
        item_ids = [hit.item_id for hit in raw_hits]
        if allowed is not None:
            item_ids = [item_id for item_id in item_ids if item_id in allowed]
        loaded = (
            {
                item.id: item
                for item in session.scalars(select(Item).where(Item.id.in_(item_ids))).all()
            }
            if item_ids
            else {}
        )
        output: list[tuple[Item, float, str]] = []
        seen: set[str] = set()
        for hit in raw_hits:
            if hit.item_id in seen:
                continue
            item = loaded.get(hit.item_id)
            if item is None or item.deleted_at is not None or item.status != "active":
                continue
            seen.add(hit.item_id)
            output.append((item, hit.score, hit.text))
        return output
