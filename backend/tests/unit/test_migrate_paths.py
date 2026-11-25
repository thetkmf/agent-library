"""Frozen (PyInstaller) resource resolution for alembic assets (B14)."""

from __future__ import annotations

import sys
from pathlib import Path

from app.db import migrate


def test_dev_mode_uses_backend_root(monkeypatch) -> None:
    monkeypatch.delattr(sys, "_MEIPASS", raising=False)
    monkeypatch.delattr(sys, "frozen", raising=False)
    assert migrate.migrations_dir() == migrate.BACKEND_ROOT / "migrations"
    assert migrate.alembic_ini_path() == migrate.BACKEND_ROOT / "alembic.ini"
    assert migrate.migrations_dir().is_dir()


def test_frozen_mode_uses_bundle_dir(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    assert migrate.migrations_dir() == tmp_path / "migrations"
    assert migrate.alembic_ini_path() == tmp_path / "alembic.ini"


def test_bundle_ships_alembic_assets() -> None:
    """pyproject/spec 必须把 alembic.ini 与 migrations 一起打进 sidecar。"""
    spec = (migrate.BACKEND_ROOT / "pkb-backend.spec").read_text(encoding="utf-8")
    assert "alembic.ini" in spec and "migrations" in spec
