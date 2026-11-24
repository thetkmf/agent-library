"""FastAPI application factory and wiring."""

from __future__ import annotations

import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from .api.v1 import api_router
from .api.v1.system import root_health_router
from .core.config import Settings, get_settings
from .core.errors import register_exception_handlers
from .core.logging import configure_logging, get_logger
from .core.middleware import RequestContextMiddleware
from .core.paths import ensure_layout
from .db.migrate import run_migrations
from .db.session import create_engine_for, create_session_factory
from .services.agent import AgentService
from .services.embedding import EmbeddingService
from .services.indexing import IndexService
from .services.search import SearchService
from .services.uploads import cleanup_expired
from .services.vector_store import MemoryVectorStore, build_vector_store

logger = get_logger("pkb.app")


def _warm_embedding_safely(service: EmbeddingService) -> None:
    """Load the local embedding model in the background; failures only log."""
    try:
        service.warm_up()
        logger.info("embedding.warmed_up")
    except Exception as exc:  # pragma: no cover - 依赖装配异常
        logger.warning("embedding.warm_up_failed", extra={"fields": {"reason": type(exc).__name__}})


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Prepare the data layout on startup and log lifecycle events."""
    settings: Settings = app.state.settings
    layout = ensure_layout(settings)
    if settings.auto_migrate:
        run_migrations(settings)
    cleanup_expired(settings)
    engine = create_engine_for(settings)
    app.state.engine = engine
    session_factory = create_session_factory(engine)
    app.state.session_factory = session_factory
    vector_store = build_vector_store(settings) or MemoryVectorStore()
    app.state.vector_store = vector_store
    embedding_service = EmbeddingService(settings)
    if settings.embedding_auto_warmup:
        # 后台预热，不阻塞启动（默认关，避免离线/测试环境即发外联）
        threading.Thread(
            target=_warm_embedding_safely, args=(embedding_service,), daemon=True
        ).start()
    index_service = IndexService(settings, session_factory, vector_store, embedding_service)
    app.state.index_service = index_service
    search_service = SearchService(settings, session_factory, vector_store, embedding_service)
    app.state.search_service = search_service
    app.state.agent_service = AgentService(settings, session_factory, search_service)
    interrupted = index_service.recover_interrupted()
    if interrupted:
        logger.info("index.recovered", extra={"fields": {"tasks": interrupted}})
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
        engine.dispose()
        logger.info("app.stopped", extra={"fields": {"version": settings.app_version}})


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application."""
    resolved = settings or get_settings()
    configure_logging(resolved.log_level, resolved.log_file)
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


def run() -> None:
    """Start the server with settings-driven host/port; used by `python -m app.main`."""
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_file)
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_config=None,
        access_log=False,
    )


app = create_app()


if __name__ == "__main__":
    run()
