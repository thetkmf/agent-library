"""Alembic environment: URL and metadata come from the application code."""

from __future__ import annotations

import logging
from pathlib import Path

from alembic import context
from app.core.config import get_settings
from app.db import models  # noqa: F401  确保模型注册到 metadata
from app.db.base import Base, UtcDateTime
from app.db.session import build_database_url
from sqlalchemy import engine_from_config, pool
from sqlalchemy.engine import make_url

config = context.config
# 不加载 alembic.ini 的 logging 配置：它会替换 root handler，破坏应用的 JSON 日志
# 与 PKB_LOG_FILE 文件句柄（迁移在应用 lifespan 内执行）。
logging.getLogger("alembic").setLevel(logging.WARNING)

target_metadata = Base.metadata


def render_item(type_: str, obj: object, autogen_context: object) -> str | bool:
    """Render the project's custom UTC type with an explicit import."""
    if type_ == "type" and isinstance(obj, UtcDateTime):
        imports = getattr(autogen_context, "imports", None)
        if imports is not None:
            imports.add("from app.db.base import UtcDateTime")
        return "UtcDateTime()"
    return False


def _ensure_sqlite_dir(url: str) -> None:
    """SQLite 不会自动建目录，先保证数据库文件的父目录存在。"""
    parsed = make_url(url)
    if parsed.get_backend_name() != "sqlite":
        return
    database = parsed.database
    if not database or database == ":memory:":
        return
    Path(database).expanduser().parent.mkdir(parents=True, exist_ok=True)


def _resolve_url() -> str:
    configured = config.get_main_option("sqlalchemy.url") or ""
    url = configured if configured else build_database_url(get_settings())
    _ensure_sqlite_dir(url)
    return url


def run_migrations_offline() -> None:
    """Emit SQL without connecting (used for review)."""
    context.configure(
        url=_resolve_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        render_item=render_item,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against the configured database."""
    section = config.get_section(config.config_ini_section, {}) or {}
    section["sqlalchemy.url"] = _resolve_url()
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            render_as_batch=True,
            render_item=render_item,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
