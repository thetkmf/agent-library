"""Contract: every documented endpoint exists with the documented method (B13)."""

from __future__ import annotations

from typing import Any

import pytest
from app.core.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient

DOCUMENTED_ENDPOINTS: dict[str, set[str]] = {
    "/api/v1/health": {"get"},
    "/api/v1/system/info": {"get"},
    "/api/v1/system/capabilities": {"get"},
    "/api/v1/items": {"get", "post"},
    "/api/v1/items/{item_id}": {"get", "patch", "delete"},
    "/api/v1/items/{item_id}/content": {"get", "put"},
    "/api/v1/items/{item_id}/restore": {"post"},
    "/api/v1/items/{item_id}/tags": {"post"},
    "/api/v1/items/{item_id}/tags/{tag_id}": {"delete"},
    "/api/v1/tags": {"get", "post"},
    "/api/v1/tags/{tag_id}": {"patch", "delete"},
    "/api/v1/timeline": {"get"},
    "/api/v1/files": {"post"},
    "/api/v1/files/{asset_id}/download": {"get"},
    "/api/v1/uploads": {"post"},
    "/api/v1/uploads/{upload_id}/chunks/{index}": {"put"},
    "/api/v1/uploads/{upload_id}/complete": {"post"},
    "/api/v1/index/reindex": {"post"},
    "/api/v1/index/status": {"get"},
    "/api/v1/search": {"get"},
    "/api/v1/agent/chat": {"post"},
    "/api/v1/agent/conversations": {"get"},
    "/api/v1/agent/conversations/{conversation_id}": {"get", "delete"},
    "/api/v1/ai/tasks": {"get", "post"},
    "/api/v1/ai/tasks/{task_id}": {"get"},
    "/api/v1/ai/tasks/{task_id}/cancel": {"post"},
    "/api/v1/ai/suggestions": {"get"},
    "/api/v1/ai/suggestions/{suggestion_id}/accept": {"post"},
    "/api/v1/ai/suggestions/{suggestion_id}/reject": {"post"},
    "/api/v1/ai/profile": {"get"},
    "/api/v1/ai/profile/refresh": {"post"},
    "/api/v1/reminders": {"get", "post"},
    "/api/v1/reminders/{reminder_id}": {"patch", "delete"},
    "/api/v1/reminders/{reminder_id}/done": {"post"},
    "/api/v1/reminders/{reminder_id}/snooze": {"post"},
    "/api/v1/events/stream": {"get"},
    "/api/v1/learning/plans": {"get", "post"},
    "/api/v1/learning/plans/{plan_id}": {"get", "patch", "delete"},
    "/api/v1/learning/plans/{plan_id}/milestones": {"post"},
    "/api/v1/learning/milestones/{milestone_id}": {"patch", "delete"},
    "/api/v1/learning/progress": {"get"},
    "/api/v1/graph": {"get"},
    "/api/v1/graph/neighbors/{item_id}": {"get"},
    "/api/v1/graph/stats": {"get"},
    "/api/v1/settings": {"get", "patch"},
    "/api/v1/settings/test-model": {"post"},
    "/api/v1/profile": {"get", "patch"},
}

UNAUTHENTICATED = {"/api/v1/health"}


@pytest.fixture(scope="module")
def schema(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    settings = Settings(
        token="test-token-0123456789abcdef",
        data_dir=tmp_path_factory.mktemp("contract") / "data",
        _env_file=None,
    )
    with TestClient(create_app(settings)):
        pass
    return create_app(settings).openapi()


def test_every_documented_endpoint_exists(schema: dict[str, Any]) -> None:
    paths = schema["paths"]
    missing = [path for path in DOCUMENTED_ENDPOINTS if path not in paths]
    assert missing == []

    for path, methods in DOCUMENTED_ENDPOINTS.items():
        actual = {method.lower() for method in paths[path]}
        assert methods <= actual, f"{path} 缺少方法：{methods - actual}"


def test_every_endpoint_requires_token_except_health(schema: dict[str, Any]) -> None:
    for path, operations in schema["paths"].items():
        if path in UNAUTHENTICATED:
            continue
        for method, operation in operations.items():
            if method not in {"get", "post", "put", "patch", "delete"}:
                continue
            assert operation.get("security"), f"{method.upper()} {path} 未声明鉴权"
