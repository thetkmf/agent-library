"""Settings and base profile endpoints (§9.10, B12)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from ...core.envelope import envelope
from ...schemas.common import Envelope, ErrorEnvelope
from ...schemas.settings import (
    ProfileBaseOut,
    ProfileBaseUpdate,
    SettingsOut,
    SettingsPatch,
    TestModelOut,
    TestModelRequest,
)
from ...services.settings_store import SettingsStore
from ..deps import SessionDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "参数不合法"},
    401: {"model": ErrorEnvelope, "description": "未认证"},
    409: {"model": ErrorEnvelope, "description": "模型未配置"},
    502: {"model": ErrorEnvelope, "description": "上游模型错误"},
    504: {"model": ErrorEnvelope, "description": "上游超时"},
}

router = APIRouter(tags=["settings"], dependencies=[Depends(require_token)])


def _store(request: Request) -> SettingsStore:
    store: SettingsStore = request.app.state.settings_store
    return store


@router.get(
    "/settings",
    response_model=Envelope[SettingsOut],
    responses=_ERROR_RESPONSES,
    summary="读取非敏感配置（Key 只回 has_key）",
)
def get_settings(request: Request, session: SessionDep) -> dict[str, Any]:
    """Return nested non-sensitive settings."""
    _ = session
    return envelope(_store(request).read())


@router.patch(
    "/settings",
    response_model=Envelope[SettingsOut],
    responses=_ERROR_RESPONSES,
    summary="更新配置（部分字段；只读分区 40002）",
)
def patch_settings(request: Request, payload: SettingsPatch, session: SessionDep) -> dict[str, Any]:
    """Patch writable settings; ``api_key`` is write-only."""
    _ = session
    return envelope(_store(request).patch(payload))


@router.post(
    "/settings/test-model",
    response_model=Envelope[TestModelOut],
    responses=_ERROR_RESPONSES,
    summary="测试模型连通性（返回延迟与模型名）",
)
async def test_model(
    request: Request, payload: TestModelRequest, session: SessionDep
) -> dict[str, Any]:
    """Call DeepSeek once with a minimal prompt; logs never include the key."""
    _ = session
    return envelope(await _store(request).test_model(payload.model))


@router.get(
    "/profile",
    response_model=Envelope[ProfileBaseOut],
    responses=_ERROR_RESPONSES,
    summary="用户基础资料",
)
def get_profile(request: Request, session: SessionDep) -> dict[str, Any]:
    """Return the base profile (not the AI profile)."""
    _ = session
    return envelope(_store(request).read_profile())


@router.patch(
    "/profile",
    response_model=Envelope[ProfileBaseOut],
    responses=_ERROR_RESPONSES,
    summary="更新基础资料（timezone 为 IANA 名称）",
)
def patch_profile(
    request: Request, payload: ProfileBaseUpdate, session: SessionDep
) -> dict[str, Any]:
    """Patch the base profile; invalid timezone → 40002."""
    _ = session
    return envelope(_store(request).patch_profile(payload))
