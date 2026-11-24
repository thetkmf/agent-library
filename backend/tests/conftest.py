"""Shared pytest fixtures."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from app.core.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient

TOKEN = "test-token-0123456789abcdef"


@pytest.fixture()
def token() -> str:
    return TOKEN


@pytest.fixture()
def settings(tmp_path: Path, token: str) -> Settings:
    return Settings(local_token=token, data_dir=tmp_path / "data", _env_file=None)


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    app = create_app(settings)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
