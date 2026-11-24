"""API v1 router aggregation."""

from __future__ import annotations

from fastapi import APIRouter

from . import (
    agent,
    ai,
    events,
    files,
    index,
    items,
    learning,
    reminders,
    search,
    system,
    tags,
    timeline,
)

api_router = APIRouter()
api_router.include_router(system.health_router)
api_router.include_router(system.system_router)
api_router.include_router(items.router)
api_router.include_router(tags.router)
api_router.include_router(timeline.router)
api_router.include_router(files.router)
api_router.include_router(index.router)
api_router.include_router(search.router)
api_router.include_router(agent.router)
api_router.include_router(ai.router)
api_router.include_router(reminders.router)
api_router.include_router(events.router)
api_router.include_router(learning.router)
