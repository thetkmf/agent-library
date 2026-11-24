"""Security: keys, paths and token never leak into responses or logs (B13)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from app.core.config import Settings
from app.main import create_app
from app.services import credentials
from fastapi.testclient import TestClient

TOKEN = "test-token-0123456789abcdef"
FAKE_KEY = "sk-super-secret-should-never-leak"


@pytest.fixture()
def log_file(tmp_path: Path) -> Path:
    return tmp_path / "logs" / "backend.log"


@pytest.fixture()
def client(tmp_path: Path, log_file: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(credentials, "get_api_key", lambda: FAKE_KEY)
    monkeypatch.setattr(credentials, "has_api_key", lambda: True)
    settings = Settings(
        token=TOKEN,
        data_dir=tmp_path / "data",
        log_file=log_file,
        privacy_allow_external_calls=True,
        _env_file=None,
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture()
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def test_key_never_returned_by_settings(client: TestClient, auth: dict[str, str]) -> None:
    response = client.get("/api/v1/settings", headers=auth)
    assert response.status_code == 200
    assert FAKE_KEY not in response.text
    assert response.json()["data"]["model"]["has_key"] is True


def test_errors_do_not_expose_paths_or_key(client: TestClient, auth: dict[str, str]) -> None:
    missing = client.get("/api/v1/items/does-not-exist", headers=auth)
    assert missing.status_code == 404
    body = missing.text
    assert FAKE_KEY not in body
    assert "pkb.sqlite3" not in body
    assert "Users" not in body


def test_token_not_logged(client: TestClient, auth: dict[str, str], log_file: Path) -> None:
    client.get("/api/v1/items", headers=auth)
    client.post("/api/v1/agent/chat", json={"messages": []}, headers=auth)
    content = log_file.read_text(encoding="utf-8", errors="replace")
    assert content.strip()
    assert TOKEN not in content
    assert FAKE_KEY not in content
    assert "Authorization" not in content
