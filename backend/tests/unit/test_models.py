"""Model defaults, constraints and cascades."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from app.core.config import Settings
from app.db.base import Base
from app.db.models import (
    Conversation,
    GraphEdge,
    GraphNode,
    Item,
    ItemTag,
    LearningPlan,
    Message,
    Milestone,
    Reminder,
    Tag,
)
from app.db.session import create_engine_for, create_session_factory
from sqlalchemy import Engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


@pytest.fixture()
def engine(tmp_path) -> Engine:
    settings = Settings(
        data_dir=tmp_path / "data",
        database_url=f"sqlite+pysqlite:///{(tmp_path / 'models.db').as_posix()}",
        _env_file=None,
    )
    engine = create_engine_for(settings)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def session(engine: Engine):
    factory = create_session_factory(engine)
    db = factory()
    try:
        yield db
    finally:
        db.close()


def test_item_defaults(session: Session) -> None:
    item = Item(type="note", title="向量检索笔记", content="# 标题")
    session.add(item)
    session.commit()

    stored = session.get(Item, item.id)
    assert stored is not None
    assert stored.status == "active"
    assert stored.version == 1
    assert stored.embedding_status == "pending"
    assert stored.deleted_at is None
    assert stored.created_at.tzinfo is UTC
    assert abs(datetime.now(UTC) - stored.created_at) < timedelta(minutes=1)
    assert len(stored.id) == 36


def test_item_rejects_unknown_type(session: Session) -> None:
    session.add(Item(type="spreadsheet", title="非法类型"))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_tag_name_is_unique(session: Session) -> None:
    session.add(Tag(name="机器学习"))
    session.commit()
    session.add(Tag(name="机器学习"))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_item_tag_rows_are_removed_with_item(session: Session) -> None:
    item = Item(type="note", title="带标签")
    tag = Tag(name="检索")
    session.add_all([item, tag])
    session.commit()
    session.add(ItemTag(item_id=item.id, tag_id=tag.id))
    session.commit()

    session.delete(item)
    session.commit()

    remaining = session.scalars(select(ItemTag).where(ItemTag.tag_id == tag.id)).all()
    assert remaining == []


def test_soft_delete_keeps_row(session: Session) -> None:
    item = Item(type="tex", title="TeX 便签", content=r"$E=mc^2$")
    session.add(item)
    session.commit()

    item.deleted_at = datetime.now(UTC)
    item.status = "trashed"
    session.commit()

    assert session.get(Item, item.id) is not None
    trashed = session.scalars(select(Item).where(Item.status == "trashed")).all()
    assert [row.id for row in trashed] == [item.id]


def test_conversation_messages_cascade(session: Session) -> None:
    conversation = Conversation(title="讨论向量检索")
    conversation.messages = [
        Message(role="user", content="什么是 RRF？"),
        Message(role="assistant", content="倒数排名融合", citations=[{"item_id": "x"}]),
    ]
    session.add(conversation)
    session.commit()

    session.delete(conversation)
    session.commit()

    assert session.scalars(select(Message)).all() == []


def test_learning_plan_milestones_and_version(session: Session) -> None:
    plan = LearningPlan(title="三个月掌握 RAG")
    plan.milestones = [
        Milestone(title="读完论文", sort_order=0),
        Milestone(title="搭出原型", sort_order=1, progress=30),
    ]
    session.add(plan)
    session.commit()

    assert plan.version == 1
    assert plan.status == "planning"
    assert [m.sort_order for m in plan.milestones] == [0, 1]

    session.delete(plan)
    session.commit()
    assert session.scalars(select(Milestone)).all() == []


def test_reminder_repeat_rule_constraint(session: Session) -> None:
    session.add(Reminder(title="每周复盘", remind_at=datetime.now(UTC), repeat_rule="weekly"))
    session.commit()
    session.add(Reminder(title="非法重复", remind_at=datetime.now(UTC), repeat_rule="hourly"))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_graph_edge_unique_per_relation(session: Session) -> None:
    source = GraphNode(label="向量检索", type="concept")
    target = GraphNode(label="RRF", type="concept")
    session.add_all([source, target])
    session.commit()

    session.add(GraphEdge(source_id=source.id, target_id=target.id, relation="related_to"))
    session.commit()
    session.add(GraphEdge(source_id=source.id, target_id=target.id, relation="related_to"))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()
