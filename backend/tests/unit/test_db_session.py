"""Engine factory, pragmas and session scope."""

from __future__ import annotations

import pytest
from app.core.config import Settings
from app.db.base import Base
from app.db.models import Item
from app.db.session import (
    build_database_url,
    create_engine_for,
    create_session_factory,
    database_path,
    session_scope,
)
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session


def _settings(tmp_path) -> Settings:
    return Settings(data_dir=tmp_path / "data", _env_file=None)


def test_database_path_lives_under_data_dir(tmp_path) -> None:
    settings = _settings(tmp_path)
    assert database_path(settings) == tmp_path / "data" / "db" / "pkb.sqlite3"
    assert build_database_url(settings).startswith("sqlite+pysqlite:///")


def test_database_url_override(tmp_path) -> None:
    settings = Settings(
        data_dir=tmp_path / "data",
        database_url="sqlite+pysqlite:///:memory:",
        _env_file=None,
    )
    assert build_database_url(settings) == "sqlite+pysqlite:///:memory:"


@pytest.fixture()
def engine(tmp_path) -> Engine:
    engine = create_engine_for(_settings(tmp_path))
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


def test_sqlite_pragmas_are_enabled(engine: Engine) -> None:
    with engine.connect() as connection:
        assert connection.execute(text("PRAGMA foreign_keys")).scalar() == 1
        journal = connection.execute(text("PRAGMA journal_mode")).scalar()
        assert str(journal).lower() == "wal"


def test_session_scope_commits(engine: Engine) -> None:
    factory = create_session_factory(engine)
    with session_scope(factory) as session:
        session.add(Item(type="note", title="提交测试"))

    with session_scope(factory) as session:
        titles = session.query(Item.title).all()
    assert [row[0] for row in titles] == ["提交测试"]


def test_session_scope_rolls_back(engine: Engine) -> None:
    factory = create_session_factory(engine)
    with pytest.raises(RuntimeError), session_scope(factory) as session:
        session.add(Item(type="note", title="回滚测试"))
        raise RuntimeError("boom")

    with Session(engine) as session:
        assert session.query(Item).count() == 0
