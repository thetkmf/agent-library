"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, Request

from ..core.config import Settings
from ..core.security import verify_bearer


def get_app_settings(request: Request) -> Settings:
    """Return the settings bound to the running application."""
    settings: Settings = request.app.state.settings
    return settings


SettingsDep = Annotated[Settings, Depends(get_app_settings)]


def require_token(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Reject requests that do not carry a valid local bearer token."""
    verify_bearer(authorization, get_app_settings(request))
