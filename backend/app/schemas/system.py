"""Models for the system endpoints."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class HealthOut(BaseModel):
    """Liveness payload; health is exempt from the envelope."""

    status: Literal["ok"] = "ok"
    version: str


class SystemInfoOut(BaseModel):
    """Runtime information about the local backend."""

    app_version: str
    backend_version: str
    api_version: str
    python_version: str
    platform: str
    data_dir: str
    environment: str


class AiCapability(BaseModel):
    """DeepSeek-only AI capability snapshot; never exposes the API key."""

    provider: Literal["deepseek"] = "deepseek"
    model: str
    has_key: bool = False
    external_calls_enabled: bool = False
    ready: bool = False


class VectorCapability(BaseModel):
    ready: bool = False
    indexed_count: int = 0


class StorageInfo(BaseModel):
    free_bytes: int


class CapabilitiesOut(BaseModel):
    """What the local installation can currently do."""

    ai: AiCapability
    vector: VectorCapability
    storage: StorageInfo
