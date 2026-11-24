"""Local bearer token enforcement."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_missing_token_returns_401(client: TestClient) -> None:
    response = client.get("/api/v1/system/info")
    body = response.json()
    assert response.status_code == 401
    assert body["code"] == 20001
    assert body["data"] is None
    assert body["message"]
    assert body["request_id"]


def test_wrong_token_returns_401(client: TestClient) -> None:
    response = client.get(
        "/api/v1/system/info",
        headers={"Authorization": "Bearer wrong-token-0000000000"},
    )
    assert response.status_code == 401
    assert response.json()["code"] == 20001


def test_wrong_scheme_returns_401(client: TestClient) -> None:
    response = client.get("/api/v1/system/info", headers={"Authorization": "Basic whatever"})
    assert response.status_code == 401
    assert response.json()["code"] == 20001


def test_valid_token_returns_success_envelope(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get("/api/v1/system/info", headers=auth_headers)
    body = response.json()
    assert response.status_code == 200
    assert set(body) == {"code", "message", "data", "request_id"}
    assert body["code"] == 0
    assert body["message"] == "ok"
    assert body["data"]["backend_version"] == "0.1.0"
    assert body["data"]["api_version"] == "v1"


def test_capabilities_payload(client: TestClient, auth_headers: dict[str, str]) -> None:
    body = client.get("/api/v1/system/capabilities", headers=auth_headers).json()
    data = body["data"]
    assert data["privacy"]["allow_external_calls"] is False
    assert data["model"]["configured"] is False
    assert data["vector"]["ready"] is False
    assert data["storage"]["total_bytes"] > 0


def test_missing_token_not_configured(tmp_path) -> None:
    from app.core.config import Settings
    from app.main import create_app

    app = create_app(Settings(data_dir=tmp_path / "data", _env_file=None))
    with TestClient(app) as client:
        response = client.get("/api/v1/system/info", headers={"Authorization": "Bearer any-token"})
    assert response.status_code == 503
    assert response.json()["code"] == 10002
