"""API v1 router aggregation."""

from __future__ import annotations

from fastapi import APIRouter

from . import system

api_router = APIRouter()
api_router.include_router(system.health_router)
api_router.include_router(system.system_router)
