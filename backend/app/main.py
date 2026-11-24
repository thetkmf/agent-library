"""FastAPI application factory and wiring."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .api.v1 import api_router
from .api.v1.system import root_health_router
from .core.config import Settings, get_settings
from .core.errors import register_exception_handlers
from .core.logging import configure_logging, get_logger
from .core.middleware import RequestContextMiddleware
from .core.paths import ensure_layout

logger = get_logger("pkb.app")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Prepare the data layout on startup and log lifecycle events."""
    settings: Settings = app.state.settings
    layout = ensure_layout(settings)
    logger.info(
        "app.started",
        extra={
            "fields": {
                "version": settings.app_version,
                "environment": settings.environment,
                "directories": len(layout.directories),
            }
        },
    )
    try:
        yield
    finally:
        logger.info("app.stopped", extra={"fields": {"version": settings.app_version}})


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application."""
    resolved = settings or get_settings()
    configure_logging(resolved.log_level)
    app = FastAPI(
        title="Personal Knowledge Base API",
        version=resolved.app_version,
        description="本地知识库后端服务。业务接口统一返回 {code,message,data,request_id} 信封。",
        lifespan=lifespan,
        docs_url=f"{resolved.api_prefix}/docs",
        redoc_url=None,
        openapi_url="/openapi.json",
    )
    app.state.settings = resolved
    app.add_middleware(RequestContextMiddleware, slow_request_ms=resolved.slow_request_ms)
    register_exception_handlers(app)
    app.include_router(root_health_router)
    app.include_router(api_router, prefix=resolved.api_prefix)
    return app


app = create_app()
