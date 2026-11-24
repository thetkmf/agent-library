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
        Settings(local_token="short", _env_file=None)


def test_is_loopback_host_rejects_remote_names() -> None:
    assert is_loopback_host("example.com") is False
    assert is_loopback_host("10.0.0.1") is False
    assert is_loopback_host("[::1]") is True
