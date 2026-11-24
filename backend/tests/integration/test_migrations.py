"""Alembic migration runs on startup and matches the models."""

from __future__ import annotations

from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from app.core.config import Settings
from app.db.base import Base
from app.db.migrate import run_migrations
from app.db.session import create_engine_for, database_path
from app.main import create_app
from fastapi.testclient import TestClient
from sqlalchemy import Engine, inspect

EXPECTED_TABLES = {
    "ai_tasks",
    "app_settings",
    "conversations",
    "file_assets",
    "graph_edges",
    "graph_nodes",
    "item_tags",
    "items",
    "learning_plans",
    "messages",
    "milestones",
    "reminders",
    "tags",
    "user_profiles",
}


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        token="test-token-0123456789abcdef",
        data_dir=tmp_path / "data",
        _env_file=None,
    )


def test_upgrade_creates_every_table(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    run_migrations(settings)

    engine = create_engine_for(settings)
    try:
        inspector = inspect(engine)
        assert set(inspector.get_table_names()) >= EXPECTED_TABLES
        item_indexes = {index["name"] for index in inspector.get_indexes("items")}
        assert {"ix_items_created_at", "ix_items_status", "ix_items_type"} <= item_indexes
        reminder_indexes = {index["name"] for index in inspector.get_indexes("reminders")}
        assert "ix_reminders_remind_at_status" in reminder_indexes
        assert database_path(settings).exists()
    finally:
        engine.dispose()


def test_migrations_are_idempotent(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    run_migrations(settings)
    run_migrations(settings)

    engine = create_engine_for(settings)
    try:
        assert set(inspect(engine).get_table_names()) >= EXPECTED_TABLES
    finally:
        engine.dispose()


def test_models_match_database_schema(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    run_migrations(settings)

    engine = create_engine_for(settings)
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(connection, opts={"compare_type": True})
            diffs = compare_metadata(context, Base.metadata)
    finally:
        engine.dispose()
    assert diffs == [], f"模型与迁移不一致：{diffs}"


def test_app_lifespan_prepares_database(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/v1/health").status_code == 200
        engine: Engine = client.app.state.engine
        assert "items" in inspect(engine).get_table_names()
        assert client.app.state.session_factory is not None
        assert database_path(settings).exists()
