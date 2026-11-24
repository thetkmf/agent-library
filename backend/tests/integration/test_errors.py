"""Global error envelope behaviour."""

from __future__ import annotations

from typing import Any

from app.core.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient


def _probe_app(settings: Settings) -> Any:
    app = create_app(settings)

    @app.get("/api/v1/_probe/validate")
    def validate(limit: int) -> dict[str, int]:
        return {"limit": limit}

    @app.get("/api/v1/_probe/boom")
    def boom() -> dict[str, str]:
        raise RuntimeError("boom")

    return app


def test_validation_error_uses_registered_code(settings: Settings) -> None:
    with TestClient(_probe_app(settings), raise_server_exceptions=False) as client:
        response = client.get("/api/v1/_probe/validate", params={"limit": "abc"})
    body = response.json()
    assert response.status_code == 422
    assert body["code"] == 40001
    assert body["details"]["errors"]
    assert body["request_id"]


def test_validation_error_lists_missing_field(settings: Settings) -> None:
    with TestClient(_probe_app(settings), raise_server_exceptions=False) as client:
        response = client.get("/api/v1/_probe/validate")
    assert response.status_code == 422
    assert response.json()["message"].startswith("参数校验失败")


def test_unexpected_error_hides_details(settings: Settings) -> None:
    with TestClient(_probe_app(settings), raise_server_exceptions=False) as client:
        response = client.get("/api/v1/_probe/boom")
    body = response.json()
    assert response.status_code == 500
    assert body["code"] == 10001
    assert "boom" not in body["message"]


def test_unknown_route_returns_not_found_code(client: TestClient) -> None:
    response = client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.json()["code"] == 30001
