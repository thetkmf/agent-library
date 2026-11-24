"""Contract tests: the exported schema stays in sync with the code."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from app.core.config import Settings
from app.main import create_app

OPENAPI_PATH = Path(__file__).resolve().parents[2] / "openapi.json"


@pytest.fixture(scope="module")
def schema() -> dict[str, object]:
    return create_app(Settings(_env_file=None)).openapi()


def test_system_endpoints_documented(schema: dict[str, object]) -> None:
    paths = schema["paths"]
    assert isinstance(paths, dict)
    assert "/api/v1/health" in paths
    assert "/api/v1/system/info" in paths
    assert "/api/v1/system/capabilities" in paths


def test_success_envelope_shape(schema: dict[str, object]) -> None:
    components = schema["components"]
    assert isinstance(components, dict)
    envelope = components["schemas"]["Envelope_SystemInfoOut_"]
    assert set(envelope["properties"]) >= {"code", "message", "data", "request_id"}


def test_committed_openapi_matches_code(schema: dict[str, object]) -> None:
    if not OPENAPI_PATH.exists():
        pytest.skip("openapi.json 尚未导出")
    committed = json.loads(OPENAPI_PATH.read_text(encoding="utf-8"))
    assert committed == schema
