"""Knowledge graph queries: subgraph, neighbours and stats (B11).

建图本身由 B8 的 ``graph_build`` 任务完成；这里只做只读查询。
"""

from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from ..core.config import Settings
from ..core.errors import not_found, unsupported_query
from ..db.base import utcnow
from ..db.models import GraphEdge, GraphNode, Item
from ..schemas.graph import GraphEdgeOut, GraphNodeOut, GraphOut, GraphStatsOut

DEFAULT_DEPTH = 2
MAX_DEPTH = 4
DEFAULT_LIMIT = 500
MAX_LIMIT = 2000


class GraphService:
    """Read-only graph queries."""

    def __init__(self, settings: Settings, session_factory: sessionmaker[Session]) -> None:
        self.settings = settings
        self.session_factory = session_factory

    def subgraph(
        self,
        *,
        center_id: str | None = None,
        depth: int = DEFAULT_DEPTH,
        types: Sequence[str] | None = None,
        limit: int = DEFAULT_LIMIT,
    ) -> GraphOut:
        if not 1 <= depth <= MAX_DEPTH:
            raise unsupported_query(f"depth 必须在 1 到 {MAX_DEPTH} 之间")
        if not 1 <= limit <= MAX_LIMIT:
            raise unsupported_query(f"limit 必须在 1 到 {MAX_LIMIT} 之间")
        with self.session_factory() as session:
            nodes, edges = self._query(session, center_id, depth, types, limit)
            return GraphOut(nodes=nodes, edges=edges)

    def neighbors(self, item_id: str) -> GraphOut:
        with self.session_factory() as session:
            item = session.get(Item, item_id)
            if item is None:
                raise not_found("条目不存在")
            node = session.scalar(
                select(GraphNode).where(GraphNode.type == "item", GraphNode.item_id == item_id)
            )
            if node is None:
                return GraphOut(nodes=[], edges=[])
            nodes, edges = self._bfs(session, {node.id}, depth=1, types=None, limit=DEFAULT_LIMIT)
            return GraphOut(nodes=nodes, edges=edges)

    def stats(self) -> GraphStatsOut:
        with self.session_factory() as session:
            node_count = int(session.scalar(select(func.count()).select_from(GraphNode)) or 0)
            edge_count = int(session.scalar(select(func.count()).select_from(GraphEdge)) or 0)
            node_ids = set(session.scalars(select(GraphNode.id)).all())
            linked = set(session.scalars(select(GraphEdge.source_id)).all()) | set(
                session.scalars(select(GraphEdge.target_id)).all()
            )
        return GraphStatsOut(
            node_count=node_count,
            edge_count=edge_count,
            isolated_node_count=len(node_ids - linked),
            updated_at=utcnow(),
        )

    # ---- internals --------------------------------------------------
    def _query(
        self,
        session: Session,
        center_id: str | None,
        depth: int,
        types: Sequence[str] | None,
        limit: int,
    ) -> tuple[list[GraphNodeOut], list[GraphEdgeOut]]:
        if center_id:
            node = session.get(GraphNode, center_id)
            if node is None:
                item = session.get(Item, center_id)
                if item is None:
                    raise not_found("节点或条目不存在")
                node = session.scalar(
                    select(GraphNode).where(
                        GraphNode.type == "item", GraphNode.item_id == center_id
                    )
                )
                if node is None:
                    return [], []
            return self._bfs(session, {node.id}, depth=depth, types=types, limit=limit)

        stmt = select(GraphNode)
        if types:
            stmt = stmt.where(GraphNode.type.in_(list(types)))
        rows = session.scalars(
            stmt.order_by(GraphNode.weight.desc(), GraphNode.id.asc()).limit(limit)
        ).all()
        node_ids = {row.id for row in rows}
        return self._collect(session, rows, node_ids)

    def _bfs(
        self,
        session: Session,
        seeds: set[str],
        *,
        depth: int,
        types: Sequence[str] | None,
        limit: int,
    ) -> tuple[list[GraphNodeOut], list[GraphEdgeOut]]:
        adjacency: dict[str, set[str]] = defaultdict(set)
        for edge in session.scalars(select(GraphEdge)).all():
            adjacency[edge.source_id].add(edge.target_id)
            adjacency[edge.target_id].add(edge.source_id)

        visited: set[str] = set(seeds)
        queue: deque[tuple[str, int]] = deque((seed, 0) for seed in seeds)
        while queue and len(visited) < limit:
            current, level = queue.popleft()
            if level >= depth:
                continue
            for neighbour in adjacency.get(current, ()):
                if neighbour in visited:
                    continue
                visited.add(neighbour)
                queue.append((neighbour, level + 1))
                if len(visited) >= limit:
                    break

        rows = session.scalars(select(GraphNode).where(GraphNode.id.in_(visited))).all()
        if types:
            allowed = set(types)
            rows = [row for row in rows if row.type in allowed]
        keep = {row.id for row in rows}
        keep |= seeds & keep  # 中心节点缺失时保持空集合语义
        return self._collect(session, rows, keep)

    def _collect(
        self, session: Session, rows: Sequence[GraphNode], node_ids: set[str]
    ) -> tuple[list[GraphNodeOut], list[GraphEdgeOut]]:
        if not node_ids:
            return [], []
        edges = session.scalars(
            select(GraphEdge).where(
                GraphEdge.source_id.in_(node_ids), GraphEdge.target_id.in_(node_ids)
            )
        ).all()
        nodes_out = [
            GraphNodeOut(
                id=row.id,
                label=row.label,
                type=row.type,
                weight=float(row.weight or 0.0),
                item_id=row.item_id,
            )
            for row in sorted(rows, key=lambda node: (-(node.weight or 0.0), node.id))
        ]
        edges_out = [
            GraphEdgeOut(
                id=edge.id,
                source=edge.source_id,
                target=edge.target_id,
                relation=edge.relation,
                weight=float(edge.weight or 0.0),
            )
            for edge in sorted(edges, key=lambda edge: edge.id)
        ]
        return nodes_out, edges_out
