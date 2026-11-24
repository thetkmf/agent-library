"""Engine / session management for the local SQLite database."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from ..core.config import Settings
from ..core.paths import build_layout

DEFAULT_DB_FILENAME = "pkb.sqlite3"

# 只接受这些 PRAGMA；SQLite 的默认外键关闭会让级联删除静默失效
_PRAGMAS = (
    "PRAGMA foreign_keys=ON",
    "PRAGMA journal_mode=WAL",
    "PRAGMA synchronous=NORMAL",
    "PRAGMA busy_timeout=5000",
)


def database_path(settings: Settings) -> Path:
    """Return the SQLite database file path for the given settings."""
    return build_layout(settings).db_dir / DEFAULT_DB_FILENAME


def build_database_url(settings: Settings) -> str:
    """Return the SQLAlchemy URL, honouring an explicit override."""
    if settings.database_url:
        return settings.database_url
    return f"sqlite+pysqlite:///{database_path(settings).as_posix()}"


def _apply_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
    cursor = dbapi_connection.cursor()
    try:
        for pragma in _PRAGMAS:
            cursor.execute(pragma)
    finally:
        cursor.close()


def create_engine_for(settings: Settings) -> Engine:
    """Create the SQLite engine with the pragmas this app depends on."""
    url = build_database_url(settings)
    if url.startswith("sqlite"):
        database_path(settings).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, future=True, connect_args={"check_same_thread": False})
    if engine.dialect.name == "sqlite":
        event.listen(engine, "connect", _apply_pragmas)
    return engine


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    """Return the session factory bound to the engine."""
    return sessionmaker(bind=engine, expire_on_commit=False, autoflush=False, future=True)


@contextmanager
def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    """Transactional scope: commit on success, rollback on failure."""
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
