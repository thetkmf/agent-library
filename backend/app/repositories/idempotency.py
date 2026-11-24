"""Persistence for Idempotency-Key replay entries."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ..db.models import IdempotencyKey


def get_entry(session: Session, key: str, scope: str) -> IdempotencyKey | None:
    """Load a stored replay entry for the given scope."""
    entry = session.get(IdempotencyKey, key)
    if entry is None or entry.scope != scope:
        return None
    return entry


def save_entry(
    session: Session,
    *,
    key: str,
    scope: str,
    request_hash: str,
    response_data: dict[str, Any],
) -> None:
    """Store the first response so later retries can be replayed."""
    session.add(
        IdempotencyKey(
            key=key,
            scope=scope,
            request_hash=request_hash,
            response_data=response_data,
        )
    )
    session.flush()
