"""Log file contract: PKB_LOG_FILE writes structured JSON lines."""

from __future__ import annotations

import json
from pathlib import Path

from app.core.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient


def test_log_file_receives_json_lines(tmp_path: Path) -> None:
    log_file = tmp_path / "logs" / "backend.log"
    settings = Settings(
        token="test-token-0123456789abcdef",
        data_dir=tmp_path / "data",
        log_file=log_file,
        _env_file=None,
    )
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").status_code == 200
        # FileHandler 是延迟打开的，确保进程内句柄刷盘
        import logging

        for handler in logging.getLogger().handlers:
            handler.flush()

    assert log_file.exists()
    lines = [json.loads(line) for line in log_file.read_text(encoding="utf-8").splitlines() if line]
    events = {line["event"] for line in lines}
    assert "app.started" in events
    assert "http.request" in events
    assert all({"ts", "level", "module", "request_id"} <= set(line) for line in lines)
