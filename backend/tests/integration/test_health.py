"""Health endpoints are public and envelope-free."""

from __future__ import annotations

from fastapi.testclient import TestClient

REQUEST_ID = "0199a3f2-8b1c-7d2e-9f00-1a2b3c4d5e6f"


def test_root_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}


def test_api_prefixed_health(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_without_token(client: TestClient) -> None:
    assert client.get("/api/v1/health").status_code == 200


def test_request_id_is_echoed(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-Id": REQUEST_ID})
    assert response.headers["X-Request-Id"] == REQUEST_ID


def test_request_id_is_generated_when_missing(client: TestClient) -> None:
    response = client.get("/health")
    assert len(response.headers["X-Request-Id"]) >= 32
