"""Application settings: environment > user config file > defaults."""

from __future__ import annotations

import ipaddress
import os
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_NAME = "PersonalKnowledgeBase"
APP_VERSION = "0.1.0"
API_PREFIX = "/api/v1"
API_VERSION = "v1"
MODEL_PROVIDER = "deepseek"
MODEL_BASE_URL = "https://api.deepseek.com"
MODEL_NAMES = ("deepseek-chat", "deepseek-reasoner")
DEFAULT_MODEL_NAME = MODEL_NAMES[0]
EMBEDDING_MODEL = "bge-small-zh-v1.5"
EMBEDDING_DIMENSION = 512
EMBEDDING_STATUSES = ("ready", "missing", "loading", "error")
DEFAULT_ALLOWED_EXTENSIONS = (
    "md",
    "tex",
    "txt",
    "pdf",
    "docx",
    "pptx",
    "xlsx",
    "png",
    "jpg",
    "jpeg",
    "webp",
    "svg",
    "mp3",
    "wav",
    "mp4",
    "zip",
)
MAX_SMALL_FILE_BYTES = 50 * 1024 * 1024
MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
DEFAULT_CHUNK_SIZE_BYTES = 8 * 1024 * 1024
EMBEDDING_MODEL_DIRNAME = "models"
EMBEDDING_BATCH_SIZE = 32
EMBEDDING_MAX_WORKERS = 2
CHUNK_SIZE_CHARS = 800
CHUNK_OVERLAP_CHARS = 100
CHUNK_MAX_PER_ITEM = 400
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
        populate_by_name=True,
    )

    app_name: str = APP_NAME
    app_version: str = APP_VERSION
    api_prefix: str = API_PREFIX
    environment: str = "development"
    debug: bool = False
    host: str = "127.0.0.1"
    port: int = Field(default=8765, ge=0, le=65535)
    # 启动契约由 Electron 主进程注入（PKB_TOKEN）；PKB_LOCAL_TOKEN 保留为本地开发别名
    token: str | None = Field(
        default=None,
        validation_alias=AliasChoices("PKB_TOKEN", "PKB_LOCAL_TOKEN"),
    )
    log_file: Path | None = None
    data_dir: Path = Field(default_factory=default_data_dir)
    # 显式覆盖数据库地址（测试用）；默认落在 <data_dir>/db/pkb.sqlite3
    database_url: str | None = None
    auto_migrate: bool = True
    log_level: str = "INFO"
    slow_request_ms: int = Field(default=1000, ge=0)
    privacy_allow_external_calls: bool = False
    model_name: str = DEFAULT_MODEL_NAME
    # DeepSeek 凭据：优先环境变量，其次 Windows 凭据管理器（见 services/llm.resolve_api_key）
    deepseek_api_key: str | None = Field(default=None, repr=False)
    llm_connect_timeout_s: float = Field(default=10.0, gt=0)
    llm_read_timeout_s: float = Field(default=120.0, gt=0)
    agent_tool_rounds: int = Field(default=4, ge=1, le=8)
    agent_max_context_items: int = Field(default=20, ge=0, le=50)
    agent_max_citations: int = Field(default=10, ge=1, le=50)
    agent_sse_heartbeat_s: float = Field(default=15.0, gt=0)
    agent_history_messages: int = Field(default=20, ge=1, le=100)
    agent_tool_content_chars: int = Field(default=4000, ge=200, le=20000)
    # 向量嵌入在本地推理，不走 DeepSeek（见决策记录）
    embedding_model: str = EMBEDDING_MODEL
    embedding_dimension: int = Field(default=EMBEDDING_DIMENSION, ge=1)
    allowed_extensions: tuple[str, ...] = DEFAULT_ALLOWED_EXTENSIONS
    max_small_file_bytes: int = Field(default=MAX_SMALL_FILE_BYTES, ge=1)
    max_file_bytes: int = Field(default=MAX_FILE_BYTES, ge=1)
    chunk_size_bytes: int = Field(default=DEFAULT_CHUNK_SIZE_BYTES, ge=1024)
    # 向量嵌入（本地推理，不经过 DeepSeek）
    embedding_model_dir: Path | None = None
    embedding_model_sha256: str | None = None
    # 首次部署时允许后台下载/加载本地模型（默认关，避免测试与离线环境即发外联）
    embedding_auto_warmup: bool = False
    embedding_batch_size: int = Field(default=EMBEDDING_BATCH_SIZE, ge=1, le=256)
    embedding_max_workers: int = Field(default=EMBEDDING_MAX_WORKERS, ge=1, le=8)
    chunk_chars: int = Field(default=CHUNK_SIZE_CHARS, ge=100, le=4000)
    chunk_overlap_chars: int = Field(default=CHUNK_OVERLAP_CHARS, ge=0, le=1000)
    chunk_max_per_item: int = Field(default=CHUNK_MAX_PER_ITEM, ge=1, le=5000)

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

    @field_validator("allowed_extensions")
    @classmethod
    def _validate_extensions(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        cleaned: list[str] = []
        for raw in value:
            ext = raw.strip().lower().lstrip(".")
            if not ext:
                continue
            if not ext.isalnum():
                raise ValueError(f"扩展名只能是字母数字：{raw!r}")
            if ext not in cleaned:
                cleaned.append(ext)
        if not cleaned:
            raise ValueError("allowed_extensions 不能为空")
        return tuple(cleaned)

    @field_validator("token")
    @classmethod
    def _validate_token(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if len(cleaned) < 16:
            raise ValueError("token 至少 16 个字符")
        return cleaned


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings instance."""
    return Settings()
