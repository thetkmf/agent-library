"""Application settings: environment > user config file > defaults."""

from __future__ import annotations

import ipaddress
import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_NAME = "PersonalKnowledgeBase"
APP_VERSION = "0.1.0"
API_PREFIX = "/api/v1"
API_VERSION = "v1"
MODEL_PROVIDER = "deepseek"
MODEL_BASE_URL = "https://api.deepseek.com"
MODEL_NAMES = ("deepseek-chat", "deepseek-reasoner")
DEFAULT_MODEL_NAME = MODEL_NAMES[0]
LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
_LOOPBACK_NAMES = frozenset({"localhost", "::1", "0:0:0:0:0:0:0:1"})


def default_data_dir() -> Path:
    """Resolve the default per-user data directory."""
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / APP_NAME
    return Path.home() / ".local" / "share" / APP_NAME


def is_loopback_host(host: str) -> bool:
    """Return True when the address can only be reached from this machine."""
    value = host.strip().lower().strip("[]")
    if value in _LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


class Settings(BaseSettings):
    """Runtime settings for the local backend service."""

    model_config = SettingsConfigDict(
        env_prefix="PKB_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        validate_default=True,
    )

    app_name: str = APP_NAME
    app_version: str = APP_VERSION
    api_prefix: str = API_PREFIX
    environment: str = "development"
    debug: bool = False
    host: str = "127.0.0.1"
    port: int = Field(default=8765, ge=0, le=65535)
    local_token: str | None = None
    data_dir: Path = Field(default_factory=default_data_dir)
    log_level: str = "INFO"
    slow_request_ms: int = Field(default=1000, ge=0)
    privacy_allow_external_calls: bool = False
    model_name: str = DEFAULT_MODEL_NAME

    @field_validator("host")
    @classmethod
    def _validate_host(cls, value: str) -> str:
        cleaned = value.strip()
        if not is_loopback_host(cleaned):
            raise ValueError(f"host 只允许回环地址，收到 {cleaned!r}")
        return cleaned

    @field_validator("log_level")
    @classmethod
    def _validate_log_level(cls, value: str) -> str:
        level = value.strip().upper()
        if level not in LOG_LEVELS:
            raise ValueError(f"不支持的日志级别：{value!r}")
        return level

    @field_validator("model_name")
    @classmethod
    def _validate_model_name(cls, value: str) -> str:
        name = value.strip()
        if name not in MODEL_NAMES:
            raise ValueError(f"不支持的模型：{value!r}，仅允许 {', '.join(MODEL_NAMES)}")
        return name

    @field_validator("local_token")
    @classmethod
    def _validate_local_token(cls, value: str | None) -> str | None:
        if value is None:
            return None
        token = value.strip()
        if len(token) < 16:
            raise ValueError("local_token 至少 16 个字符")
        return token


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings instance."""
    return Settings()
