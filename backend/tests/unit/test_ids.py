"""UUID v7 helpers."""

from __future__ import annotations

import uuid

from app.core.ids import new_id, uuid7


def test_new_id_is_rfc4122_uuid7() -> None:
    value = uuid.UUID(new_id())
    assert value.version == 7
    assert value.variant == uuid.RFC_4122
    first = new_id()
    assert first == first.lower()
    assert len(first) == 36


def test_ids_sort_by_creation_time() -> None:
    ids = [uuid7() for _ in range(5)]
    assert ids == sorted(ids)
