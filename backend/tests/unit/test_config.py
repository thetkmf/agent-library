"""Settings validation rules."""

from __future__ import annotations

import pytest
from app.core.config import Settings, is_loopback_host
from pydantic import ValidationError


def test_rejects_non_loopback_host() -> None:
    with pytest.raises(ValidationError):
        Settings(host="0.0.0.0", _env_file=None)


def test_rejects_public_host() -> None:
    with pytest.raises(ValidationError):
        Settings(host="192.168.1.10", _env_file=None)


@pytest.mark.parametrize("host", ["127.0.0.1", "127.0.0.53", "::1", "localhost"])
def test_accepts_loopback_hosts(host: str) -> None:
    assert Settings(host=host, _env_file=None).host == host


def test_rejects_unknown_log_level() -> None:
    with pytest.raises(ValidationError):
        Settings(log_level="chatty", _env_file=None)


def test_rejects_short_token() -> None:
    with pytest.raises(ValidationError):
        Settings(token="short", _env_file=None)


def test_is_loopback_host_rejects_remote_names() -> None:
    assert is_loopback_host("example.com") is False
    assert is_loopback_host("10.0.0.1") is False
    assert is_loopback_host("[::1]") is True


def test_rejects_unknown_model() -> None:
    with pytest.raises(ValidationError):
        Settings(model_name="gpt-4o", _env_file=None)


@pytest.mark.parametrize("name", ["deepseek-chat", "deepseek-reasoner"])
def test_accepts_whitelisted_models(name: str) -> None:
    assert Settings(model_name=name, _env_file=None).model_name == name


def test_token_from_startup_contract_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PKB_TOKEN", "contract-token-0123456789")
    monkeypatch.delenv("PKB_LOCAL_TOKEN", raising=False)
    assert Settings(_env_file=None).token == "contract-token-0123456789"


def test_token_from_legacy_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PKB_TOKEN", raising=False)
    monkeypatch.setenv("PKB_LOCAL_TOKEN", "legacy-token-0123456789")
    assert Settings(_env_file=None).token == "legacy-token-0123456789"


def test_log_file_from_env(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("PKB_LOG_FILE", str(tmp_path / "backend.log"))
    assert Settings(_env_file=None).log_file == tmp_path / "backend.log"
