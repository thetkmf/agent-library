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


class ModelCapability(BaseModel):
    configured: bool = False
    provider: str | None = None
    model: str | None = None


class VectorCapability(BaseModel):
    ready: bool = False
    indexed_items: int = 0


class StorageInfo(BaseModel):
    free_bytes: int
    total_bytes: int


class PrivacyInfo(BaseModel):
    allow_external_calls: bool = False


class CapabilitiesOut(BaseModel):
    """What the local installation can currently do."""

    model: ModelCapability
    vector: VectorCapability
    storage: StorageInfo
    privacy: PrivacyInfo
