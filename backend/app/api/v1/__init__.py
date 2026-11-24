"""API v1 router aggregation."""

from __future__ import annotations

from fastapi import APIRouter

from . import files, items, system, tags, timeline

api_router = APIRouter()
api_router.include_router(system.health_router)
api_router.include_router(system.system_router)
api_router.include_router(items.router)
api_router.include_router(tags.router)
api_router.include_router(timeline.router)
api_router.include_router(files.router)
