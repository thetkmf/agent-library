"""Settings and base-profile payloads (§8.10 / 9.10, B12)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Theme = Literal["light", "dark", "system"]


class ModelSettings(BaseModel):
    """Model section (read response)."""

    provider: str
    name: str
    base_url: str
    has_key: bool


class EmbeddingSettings(BaseModel):
    """Local embedding section."""

    model: str
    dimension: int
    status: str


class StorageSettings(BaseModel):
    """Storage section (no absolute item paths)."""

    data_dir: str
    allowed_extensions: list[str]
    max_small_file_bytes: int
    max_file_bytes: int


class UiSettings(BaseModel):
    """UI section."""

    theme: Theme = "system"


class PrivacySettings(BaseModel):
    """Privacy section."""

    allow_external_calls: bool = False


class AiSettings(BaseModel):
    """Automation section."""

    auto_organize_enabled: bool = False


class SettingsOut(BaseModel):
    """Nested non-sensitive settings."""

    model: ModelSettings
    embedding: EmbeddingSettings
    storage: StorageSettings
    ui: UiSettings
    privacy: PrivacySettings
    ai: AiSettings


class ModelPatch(BaseModel):
    """Writable model fields; ``api_key`` is write-only."""

    name: Literal["deepseek-chat", "deepseek-reasoner"] | None = None
    api_key: str | None = None
    # 只读展示字段：出现即 40002
    provider: str | None = None
    base_url: str | None = None


class UiPatch(BaseModel):
    """Writable UI fields."""

    theme: Theme | None = None


class PrivacyPatch(BaseModel):
    """Writable privacy fields."""

    allow_external_calls: bool | None = None


class AiPatch(BaseModel):
    """Writable automation fields."""

    auto_organize_enabled: bool | None = None


class SettingsPatch(BaseModel):
    """Partial settings update."""

    model: ModelPatch | None = None
    ui: UiPatch | None = None
    privacy: PrivacyPatch | None = None
    ai: AiPatch | None = None
    # 只读分区：出现即 40002
    embedding: dict[str, Any] | None = None
    storage: dict[str, Any] | None = None


class TestModelRequest(BaseModel):
    """Body of POST /settings/test-model."""

    model: Literal["deepseek-chat", "deepseek-reasoner"] | None = None


class TestModelOut(BaseModel):
    """Connectivity result."""

    ok: bool
    model: str
    latency_ms: int


class ProfileBaseOut(BaseModel):
    """Base profile (not the AI profile)."""

    display_name: str | None = None
    bio: str | None = None
    timezone: str = "UTC"
    preferred_style: str | None = None
    updated_at: datetime | None = None


class ProfileBaseUpdate(BaseModel):
    """Partial base-profile update."""

    display_name: str | None = Field(default=None, max_length=100)
    bio: str | None = Field(default=None, max_length=2000)
    timezone: str | None = None
    preferred_style: str | None = Field(default=None, max_length=100)
