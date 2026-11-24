"""Non-sensitive settings and base profile, persisted in ``app_settings`` (B12)."""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session, sessionmaker

from ..core.config import MODEL_BASE_URL, MODEL_PROVIDER, Settings
from ..core.errors import AppError, ErrorCode, unsupported_query
from ..core.logging import get_logger
from ..db.base import utcnow
from ..db.models import AppSetting
from ..schemas.settings import (
    AiSettings,
    EmbeddingSettings,
    ModelSettings,
    PrivacySettings,
    ProfileBaseOut,
    ProfileBaseUpdate,
    SettingsOut,
    SettingsPatch,
    StorageSettings,
    TestModelOut,
    UiSettings,
)
from . import credentials
from .embedding import EmbeddingService
from .llm import DeepSeekClient, ensure_model_ready

logger = get_logger("pkb.settings")

THEME_KEY = "settings.ui.theme"
PRIVACY_KEY = "settings.privacy.allow_external_calls"
AUTO_ORGANIZE_KEY = "settings.ai.auto_organize_enabled"
MODEL_NAME_KEY = "settings.model.name"
PROFILE_KEY = "profile.base"
READ_ONLY_SECTIONS = ("embedding", "storage")


class SettingsStore:
    """Reads/writes non-sensitive settings and the base profile."""

    def __init__(
        self,
        settings: Settings,
        session_factory: sessionmaker[Session],
        embedder: EmbeddingService | None = None,
    ) -> None:
        self.settings = settings
        self.session_factory = session_factory
        self.embedder = embedder

    # ---- settings ---------------------------------------------------
    def read(self) -> SettingsOut:
        values = self._read_values()
        described = self.embedder.describe() if self.embedder is not None else None
        return SettingsOut(
            model=ModelSettings(
                provider=MODEL_PROVIDER,
                name=str(values.get(MODEL_NAME_KEY, self.settings.model_name)),
                base_url=MODEL_BASE_URL,
                has_key=credentials.has_api_key(),
            ),
            embedding=EmbeddingSettings(
                model=described.model if described else self.settings.embedding_model,
                dimension=described.dimension if described else self.settings.embedding_dimension,
                status=described.status if described else "missing",
            ),
            storage=StorageSettings(
                data_dir=str(self.settings.data_dir),
                allowed_extensions=list(self.settings.allowed_extensions),
                max_small_file_bytes=self.settings.max_small_file_bytes,
                max_file_bytes=self.settings.max_file_bytes,
            ),
            ui=UiSettings(theme=str(values.get(THEME_KEY, "system"))),
            privacy=PrivacySettings(
                allow_external_calls=bool(
                    values.get(PRIVACY_KEY, self.settings.privacy_allow_external_calls)
                )
            ),
            ai=AiSettings(auto_organize_enabled=bool(values.get(AUTO_ORGANIZE_KEY, False))),
        )

    def patch(self, payload: SettingsPatch) -> SettingsOut:
        for section in READ_ONLY_SECTIONS:
            if getattr(payload, section) is not None:
                raise unsupported_query(f"{section} 为只读配置，不能通过接口修改")
        if payload.model is not None and (payload.model.provider or payload.model.base_url):
            raise unsupported_query("model.provider / model.base_url 为固定值，不能修改")

        writes: dict[str, Any] = {}
        if payload.model is not None:
            if payload.model.name is not None:
                writes[MODEL_NAME_KEY] = payload.model.name
                self.settings.model_name = payload.model.name
            if payload.model.api_key is not None:
                credentials.set_api_key(payload.model.api_key)
        if payload.ui is not None and payload.ui.theme is not None:
            writes[THEME_KEY] = payload.ui.theme
        if payload.privacy is not None and payload.privacy.allow_external_calls is not None:
            writes[PRIVACY_KEY] = payload.privacy.allow_external_calls
            self.settings.privacy_allow_external_calls = payload.privacy.allow_external_calls
        if payload.ai is not None and payload.ai.auto_organize_enabled is not None:
            writes[AUTO_ORGANIZE_KEY] = payload.ai.auto_organize_enabled
        self._write_values(writes)
        return self.read()

    async def test_model(self, model: str | None = None) -> TestModelOut:
        api_key = credentials.get_api_key()
        ensure_model_ready(self.settings, api_key)
        assert api_key is not None
        target = model or self.settings.model_name
        previous = self.settings.model_name
        self.settings.model_name = target
        client = DeepSeekClient(self.settings, api_key)
        started = time.perf_counter()
        try:
            await client.acomplete([{"role": "user", "content": "ping"}])
        finally:
            await client.aclose()
            self.settings.model_name = previous
        latency = int((time.perf_counter() - started) * 1000)
        return TestModelOut(ok=True, model=target, latency_ms=latency)

    # ---- base profile -----------------------------------------------
    def read_profile(self) -> ProfileBaseOut:
        values = self._read_values()
        raw = values.get(PROFILE_KEY)
        if isinstance(raw, dict):
            return ProfileBaseOut(
                display_name=raw.get("display_name"),
                bio=raw.get("bio"),
                timezone=str(raw.get("timezone") or "UTC"),
                preferred_style=raw.get("preferred_style"),
                updated_at=self._read_updated_at(PROFILE_KEY),
            )
        return ProfileBaseOut(timezone=self.settings.timezone)

    def patch_profile(self, payload: ProfileBaseUpdate) -> ProfileBaseOut:
        current = self.read_profile()
        data = current.model_dump()
        data.pop("updated_at", None)
        if payload.timezone is not None:
            _validate_timezone(payload.timezone)
            data["timezone"] = payload.timezone
            self.settings.timezone = payload.timezone
        for field in ("display_name", "bio", "preferred_style"):
            value = getattr(payload, field)
            if value is not None:
                data[field] = value
        self._write_values({PROFILE_KEY: data})
        return self.read_profile()

    # ---- storage helpers --------------------------------------------
    def _read_values(self) -> dict[str, Any]:
        with self.session_factory() as session:
            rows = session.query(AppSetting).all()
            return {row.key: row.value for row in rows}

    def _read_updated_at(self, key: str) -> datetime | None:
        with self.session_factory() as session:
            row = session.get(AppSetting, key)
            return row.updated_at if row is not None else None

    def _write_values(self, writes: dict[str, Any]) -> None:
        if not writes:
            return
        with self.session_factory() as session:
            for key, value in writes.items():
                row = session.get(AppSetting, key)
                if row is None:
                    session.add(AppSetting(key=key, value=value))
                else:
                    row.value = value
                    row.updated_at = utcnow()
            session.commit()


def _validate_timezone(name: str) -> None:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise AppError(ErrorCode.UNSUPPORTED_QUERY, f"时区不合法：{name}", http_status=400) from exc
