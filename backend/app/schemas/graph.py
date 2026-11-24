"""Knowledge graph payloads (§8.8 / 9.9, B11)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

GraphNodeType = Literal["item", "tag", "concept"]


class GraphNodeOut(BaseModel):
    """One graph node."""

    id: str
    label: str
    type: str
    weight: float = 0.0
    item_id: str | None = None


class GraphEdgeOut(BaseModel):
    """Directed edge between two nodes in the same result set."""

    id: str
    source: str
    target: str
    relation: str
    weight: float = 0.0


class GraphOut(BaseModel):
    """Subgraph response."""

    nodes: list[GraphNodeOut] = Field(default_factory=list)
    edges: list[GraphEdgeOut] = Field(default_factory=list)


class GraphStatsOut(BaseModel):
    """Graph overview counters."""

    node_count: int = 0
    edge_count: int = 0
    isolated_node_count: int = 0
    updated_at: datetime
