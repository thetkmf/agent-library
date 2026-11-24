"""SQLAlchemy models for every domain object in docs/开发接口标准.md §8."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Final

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.ids import new_id
from .base import Base, SoftDeleteMixin, TimestampMixin, UtcDateTime, utcnow

ITEM_TYPES: Final[tuple[str, ...]] = ("note", "tex", "file")
ITEM_STATUSES: Final[tuple[str, ...]] = ("active", "archived", "trashed")
EMBEDDING_STATUSES: Final[tuple[str, ...]] = ("pending", "indexed", "failed", "skipped")
TASK_TYPES: Final[tuple[str, ...]] = (
    "reindex",
    "organize",
    "summarize",
    "tagging",
    "linking",
    "graph_build",
    "profile_refresh",
)
TASK_STATUSES: Final[tuple[str, ...]] = ("queued", "running", "succeeded", "failed", "canceled")
MESSAGE_ROLES: Final[tuple[str, ...]] = ("user", "assistant", "tool", "system")
SUGGESTION_TYPES: Final[tuple[str, ...]] = ("tag", "link", "summary")
SUGGESTION_STATUSES: Final[tuple[str, ...]] = ("pending", "accepted", "rejected")
REPEAT_RULES: Final[tuple[str, ...]] = ("none", "daily", "weekly", "monthly")
REMINDER_STATUSES: Final[tuple[str, ...]] = ("pending", "done", "snoozed", "canceled")
PLAN_STATUSES: Final[tuple[str, ...]] = ("planning", "active", "done", "archived")
MILESTONE_STATUSES: Final[tuple[str, ...]] = ("todo", "in_progress", "done")
GRAPH_NODE_TYPES: Final[tuple[str, ...]] = ("item", "tag", "concept")
GRAPH_RELATIONS: Final[tuple[str, ...]] = (
    "tagged_with",
    "related_to",
    "prerequisite_of",
    "references",
)


def _in_clause(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


class Tag(TimestampMixin, Base):
    """Tag used to group items."""

    __tablename__ = "tags"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)

    items: Mapped[list[Item]] = relationship(
        secondary="item_tags", back_populates="tags", viewonly=True
    )


class Item(SoftDeleteMixin, TimestampMixin, Base):
    """Unified knowledge item: note, tex snippet or uploaded file."""

    __tablename__ = "items"
    __table_args__ = (
        CheckConstraint(_in_clause("type", ITEM_TYPES), name="type"),
        CheckConstraint(_in_clause("status", ITEM_STATUSES), name="status"),
        CheckConstraint(
            _in_clause("embedding_status", EMBEDDING_STATUSES), name="embedding_status"
        ),
        Index("ix_items_created_at", "created_at"),
        Index("ix_items_status", "status"),
        Index("ix_items_type", "type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, default=None, nullable=True)
    preview: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    embedding_status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    ai_summary: Mapped[str | None] = mapped_column(Text, default=None, nullable=True)

    tags: Mapped[list[Tag]] = relationship(
        secondary="item_tags", back_populates="items", lazy="selectin"
    )
    file_asset: Mapped[FileAsset | None] = relationship(
        back_populates="item", cascade="all, delete-orphan", uselist=False, lazy="selectin"
    )


class ItemTag(Base):
    """Association table between items and tags."""

    __tablename__ = "item_tags"
    __table_args__ = (Index("ix_item_tags_tag_id", "tag_id"),)

    item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, nullable=False)


class FileAsset(Base):
    """Stored file metadata; the absolute disk path never leaves the service layer."""

    __tablename__ = "file_assets"
    __table_args__ = (
        Index("ix_file_assets_sha256", "sha256"),
        UniqueConstraint("item_id", name="item_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("items.id", ondelete="CASCADE"), nullable=False
    )
    original_name: Mapped[str] = mapped_column(String(200), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    relative_path: Mapped[str] = mapped_column(String(400), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, nullable=False)

    item: Mapped[Item] = relationship(back_populates="file_asset")


class AiTask(TimestampMixin, Base):
    """Long-running AI / index task with the queued→running→succeeded state machine."""

    __tablename__ = "ai_tasks"
    __table_args__ = (
        CheckConstraint(_in_clause("type", TASK_TYPES), name="type"),
        CheckConstraint(_in_clause("status", TASK_STATUSES), name="status"),
        CheckConstraint("progress >= 0 AND progress <= 100", name="progress_range"),
        Index("ix_ai_tasks_status_created_at", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    type: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="queued", nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    input_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    result_data: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None, nullable=True)
    error_data: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(UtcDateTime, default=None, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UtcDateTime, default=None, nullable=True)


class Conversation(TimestampMixin, Base):
    """Agent conversation."""

    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(200), default="新对话", nullable=False)

    messages: Mapped[list[Message]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )


class Message(Base):
    """Single message inside a conversation, with citations and tool calls."""

    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint(_in_clause("role", MESSAGE_ROLES), name="role"),
        Index("ix_messages_conversation_id_created_at", "conversation_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    citations: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    tool_calls: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, nullable=False)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class Reminder(TimestampMixin, Base):
    """Scheduled reminder with simple repeat rules."""

    __tablename__ = "reminders"
    __table_args__ = (
        CheckConstraint(_in_clause("repeat_rule", REPEAT_RULES), name="repeat_rule"),
        CheckConstraint(_in_clause("status", REMINDER_STATUSES), name="status"),
        Index("ix_reminders_remind_at_status", "remind_at", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, default=None, nullable=True)
    remind_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    repeat_rule: Mapped[str] = mapped_column(String(16), default="none", nullable=False)
    related_item_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    snooze_until: Mapped[datetime | None] = mapped_column(UtcDateTime, default=None, nullable=True)
    # 每次 occurrence 只推一次 reminder.due
    last_notified_at: Mapped[datetime | None] = mapped_column(
        UtcDateTime, default=None, nullable=True
    )


class LearningPlan(TimestampMixin, Base):
    """Learning plan with milestones and progress."""

    __tablename__ = "learning_plans"
    __table_args__ = (
        CheckConstraint(_in_clause("status", PLAN_STATUSES), name="status"),
        CheckConstraint("version >= 1", name="version_min"),
        Index("ix_learning_plans_status", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    goal: Mapped[str | None] = mapped_column(Text, default=None, nullable=True)
    start_date: Mapped[date | None] = mapped_column(default=None, nullable=True)
    target_date: Mapped[date | None] = mapped_column(default=None, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="planning", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    milestones: Mapped[list[Milestone]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", order_by="Milestone.sort_order"
    )


class Milestone(TimestampMixin, Base):
    """Milestone belonging to a learning plan."""

    __tablename__ = "milestones"
    __table_args__ = (
        CheckConstraint(_in_clause("status", MILESTONE_STATUSES), name="status"),
        CheckConstraint("progress >= 0 AND progress <= 100", name="progress_range"),
        Index("ix_milestones_plan_id", "plan_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    plan_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("learning_plans.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    due_date: Mapped[date | None] = mapped_column(default=None, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="todo", nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    plan: Mapped[LearningPlan] = relationship(back_populates="milestones")


class GraphNode(TimestampMixin, Base):
    """Node of the knowledge graph."""

    __tablename__ = "graph_nodes"
    __table_args__ = (
        CheckConstraint(_in_clause("type", GRAPH_NODE_TYPES), name="type"),
        Index("ix_graph_nodes_item_id", "item_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(16), default="concept", nullable=False)
    weight: Mapped[float] = mapped_column(default=0.0, nullable=False)
    item_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("items.id", ondelete="SET NULL"), default=None, nullable=True
    )


class GraphEdge(TimestampMixin, Base):
    """Directed edge between two graph nodes."""

    __tablename__ = "graph_edges"
    __table_args__ = (
        CheckConstraint(_in_clause("relation", GRAPH_RELATIONS), name="relation"),
        UniqueConstraint("source_id", "target_id", "relation", name="source_target_relation"),
        Index("ix_graph_edges_target_id", "target_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("graph_nodes.id", ondelete="CASCADE"), nullable=False
    )
    target_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("graph_nodes.id", ondelete="CASCADE"), nullable=False
    )
    relation: Mapped[str] = mapped_column(String(24), default="related_to", nullable=False)
    weight: Mapped[float] = mapped_column(default=0.0, nullable=False)


class UserProfile(Base):
    """Single-row AI profile of the user; refreshed by an AI task."""

    __tablename__ = "user_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default="default")
    interests: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    knowledge_domains: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, default=list, nullable=False
    )
    learning_goals: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    preferred_style: Mapped[str | None] = mapped_column(String(100), default=None, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class AiSuggestion(TimestampMixin, Base):
    """AI-generated suggestion awaiting accept/reject (tag / link / summary)."""

    __tablename__ = "ai_suggestions"
    __table_args__ = (
        CheckConstraint(_in_clause("type", SUGGESTION_TYPES), name="type"),
        CheckConstraint(_in_clause("status", SUGGESTION_STATUSES), name="status"),
        Index("ix_ai_suggestions_status_created_at", "status", "created_at"),
        Index("ix_ai_suggestions_item_id", "item_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("items.id", ondelete="CASCADE"), nullable=False
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(UtcDateTime, default=None, nullable=True)


class AppSetting(Base):
    """Non-sensitive user settings, stored as JSON values by key."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class IdempotencyKey(Base):
    """Stored first response for a create request, keyed by Idempotency-Key."""

    __tablename__ = "idempotency_keys"
    __table_args__ = (
        CheckConstraint("length(key) > 0", name="key_not_empty"),
        Index("ix_idempotency_keys_created_at", "created_at"),
    )

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    scope: Mapped[str] = mapped_column(String(60), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, nullable=False)
