"""Settings, DeepSeek key handling and base profile (§9.10, B12)."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from app.core.config import Settings
from app.main import create_app
from app.services import credentials
from fastapi.testclient import TestClient

TOKEN = "test-token-0123456789abcdef"


@pytest.fixture(autouse=True)
def _memory_key(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Never touch the real Windows credential store during tests."""
    store: dict[str, str] = {}
    monkeypatch.setattr(credentials, "get_api_key", lambda: store.get("key"))
    monkeypatch.setattr(credentials, "has_api_key", lambda: bool(store.get("key")))
    monkeypatch.setattr(
        credentials,
        "set_api_key",
        lambda value: (
            store.__setitem__("key", value.strip()) if value.strip() else store.pop("key", None)
        ),
    )
    monkeypatch.setattr(credentials, "clear_api_key", lambda: store.pop("key", None))
    yield


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return Settings(token=TOKEN, data_dir=tmp_path / "data", _env_file=None)


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture()
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


class FakeClient:
    """Stand-in for DeepSeekClient used by /settings/test-model."""

    def __init__(self) -> None:
        self.closed = False

    async def acomplete(self, messages: Any, *, response_format_json: bool = False) -> str:
        return "pong"

    async def aclose(self) -> None:
        self.closed = True


def test_read_settings_shape(client: TestClient, auth: dict[str, str]) -> None:
    data = client.get("/api/v1/settings", headers=auth).json()["data"]
    assert data["model"]["provider"] == "deepseek"
    assert data["model"]["base_url"] == "https://api.deepseek.com"
    assert data["model"]["has_key"] is False
    assert data["privacy"]["allow_external_calls"] is False
    assert data["ui"]["theme"] == "system"
    assert data["storage"]["allowed_extensions"]
    assert "data_dir" in data["storage"]
    assert data["embedding"]["dimension"] == 512
    assert "api_key" not in str(data)


def test_patch_writable_fields(client: TestClient, auth: dict[str, str]) -> None:
    updated = client.patch(
        "/api/v1/settings",
        json={
            "model": {"name": "deepseek-reasoner", "api_key": "sk-new-key-123456"},
            "ui": {"theme": "dark"},
            "privacy": {"allow_external_calls": True},
            "ai": {"auto_organize_enabled": True},
        },
        headers=auth,
    )
    assert updated.status_code == 200
    data = updated.json()["data"]
    assert data["model"]["name"] == "deepseek-reasoner"
    assert data["model"]["has_key"] is True
    assert data["ui"]["theme"] == "dark"
    assert data["privacy"]["allow_external_calls"] is True
    assert data["ai"]["auto_organize_enabled"] is True
    assert "sk-new-key-123456" not in updated.text

    reread = client.get("/api/v1/settings", headers=auth).json()["data"]
    assert reread["model"]["name"] == "deepseek-reasoner"
    assert reread["ui"]["theme"] == "dark"

    cleared = client.patch(
        "/api/v1/settings", json={"model": {"api_key": ""}}, headers=auth
    ).json()["data"]
    assert cleared["model"]["has_key"] is False


def test_patch_rejects_read_only_sections(client: TestClient, auth: dict[str, str]) -> None:
    for body in (
        {"model": {"provider": "openai"}},
        {"model": {"base_url": "https://example.com"}},
        {"embedding": {"dimension": 1024}},
        {"storage": {"data_dir": "D:/elsewhere"}},
    ):
        response = client.patch("/api/v1/settings", json=body, headers=auth)
        assert response.status_code == 400, body
        assert response.json()["code"] == 40002


def test_test_model_requires_key_and_consent(
    client: TestClient, auth: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.services.settings_store.DeepSeekClient", lambda *_a, **_k: FakeClient()
    )
    blocked = client.post("/api/v1/settings/test-model", json={}, headers=auth)
    assert blocked.status_code == 409
    assert blocked.json()["code"] == 50001

    client.patch(
        "/api/v1/settings",
        json={"model": {"api_key": "sk-test"}, "privacy": {"allow_external_calls": True}},
        headers=auth,
    )
    ok = client.post("/api/v1/settings/test-model", json={}, headers=auth)
    assert ok.status_code == 200
    payload = ok.json()["data"]
    assert payload["ok"] is True
    assert payload["model"] == "deepseek-chat"
    assert payload["latency_ms"] >= 0


def test_profile_defaults_and_update(client: TestClient, auth: dict[str, str]) -> None:
    initial = client.get("/api/v1/profile", headers=auth).json()["data"]
    assert initial["timezone"] == "Asia/Shanghai"
    assert initial["display_name"] is None

    updated = client.patch(
        "/api/v1/profile",
        json={"display_name": "小知", "bio": "做检索", "timezone": "UTC"},
        headers=auth,
    )
    assert updated.status_code == 200
    data = updated.json()["data"]
    assert data["display_name"] == "小知"
    assert data["timezone"] == "UTC"
    assert data["updated_at"] is not None

    invalid = client.patch("/api/v1/profile", json={"timezone": "Mars/Base"}, headers=auth)
    assert invalid.status_code == 400
    assert invalid.json()["code"] == 40002


def test_settings_endpoints_require_token(client: TestClient) -> None:
    assert client.get("/api/v1/settings").status_code == 401
    assert client.get("/api/v1/profile").status_code == 401
