"""Programmatic Alembic runner so startup always has an up-to-date schema."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config

from ..core.config import Settings
from .session import build_database_url

BACKEND_ROOT = Path(__file__).resolve().parents[2]
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"
MIGRATIONS_DIR = BACKEND_ROOT / "migrations"


def build_alembic_config(settings: Settings) -> Config:
    """Return an Alembic config bound to the resolved database URL."""
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.set_main_option("sqlalchemy.url", build_database_url(settings))
    return config


def run_migrations(settings: Settings, revision: str = "head") -> None:
    """Upgrade the database to `revision` (defaults to head)."""
    command.upgrade(build_alembic_config(settings), revision)
