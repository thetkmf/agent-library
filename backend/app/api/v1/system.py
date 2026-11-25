"""System endpoints: health, info, capabilities."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from ...core.envelope import envelope
from ...schemas.common import Envelope, ErrorEnvelope
from ...schemas.system import CapabilitiesOut, HealthOut, SystemInfoOut
from ...services import system as system_service
from ..deps import SettingsDep, require_token

_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorEnvelope, "description": "未认证"},
    503: {"model": ErrorEnvelope, "description": "服务未就绪"},
}


def _read_health(settings: SettingsDep) -> HealthOut:
    return HealthOut(status="ok", version=settings.app_version)


health_router = APIRouter(tags=["system"])
health_router.add_api_route(
    "/health",
    _read_health,
    methods=["GET"],
    response_model=HealthOut,
    summary="存活检查",
)

root_health_router = APIRouter(tags=["system"], include_in_schema=False)
root_health_router.add_api_route(
    "/health",
    _read_health,
    methods=["GET"],
    response_model=HealthOut,
    summary="存活检查（无前缀别名，供 Electron 启动探测）",
)

system_router = APIRouter(tags=["system"], dependencies=[Depends(require_token)])


@system_router.get(
    "/system/info",
    response_model=Envelope[SystemInfoOut],
    responses=_ERROR_RESPONSES,
    summary="应用与后端版本信息",
)
def system_info(settings: SettingsDep) -> dict[str, Any]:
    """Return version and data directory information."""
    return envelope(system_service.describe_service(settings))


@system_router.get(
    "/system/capabilities",
    response_model=Envelope[CapabilitiesOut],
    responses=_ERROR_RESPONSES,
    summary="当前能力：模型、向量库、存储、隐私开关",
)
def system_capabilities(settings: SettingsDep, request: Request) -> dict[str, Any]:
    """Return what the local installation can currently do."""
    store = getattr(request.app.state, "vector_store", None)
    indexed_count = 0
    if store is not None:
        try:
            indexed_count = store.count()
        except Exception:  # pragma: no cover - 向量库异常不应拖垮能力接口
            indexed_count = 0
    embedder = getattr(request.app.state, "embedding_service", None)
    return envelope(
        system_service.capabilities(
            settings,
            vector_ready=store is not None,
            indexed_count=indexed_count,
            embedder=embedder,
        )
    )
