"""Programmatic Alembic runner so startup always has an up-to-date schema."""

from __future__ import annotations

import sys
from pathlib import Path

from alembic import command
from alembic.config import Config

from ..core.config import Settings
from .session import build_database_url

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _resource_root() -> Path:
    """Resolve where ``alembic.ini``/``migrations`` live (frozen sidecar aware).

    打包后（PyInstaller onedir）资源位于 ``sys._MEIPASS``，开发态位于 backend 根目录。
    """
    bundle_dir = getattr(sys, "_MEIPASS", None)
    if getattr(sys, "frozen", False) and bundle_dir:
        return Path(bundle_dir)
    return BACKEND_ROOT


def alembic_ini_path() -> Path:
    """Return the alembic.ini path for the current runtime."""
    return _resource_root() / "alembic.ini"


def migrations_dir() -> Path:
    """Return the migrations directory for the current runtime."""
    return _resource_root() / "migrations"


def build_alembic_config(settings: Settings) -> Config:
    """Return an Alembic config bound to the resolved database URL."""
    config = Config(str(alembic_ini_path()))
    config.set_main_option("script_location", str(migrations_dir()))
    config.set_main_option("sqlalchemy.url", build_database_url(settings))
    return config


def run_migrations(settings: Settings, revision: str = "head") -> None:
    """Upgrade the database to `revision` (defaults to head)."""
    command.upgrade(build_alembic_config(settings), revision)
