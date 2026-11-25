"""UUID v7 helpers."""

from __future__ import annotations

import time
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
    # UUID v7 only guarantees ordering across milliseconds; random bits are
    # ordered arbitrarily inside the same millisecond.
    ids = []
    for _ in range(5):
        ids.append(uuid7())
        time.sleep(0.005)
    assert ids == sorted(ids)
