"""Identifier helpers (UUID v7)."""

from __future__ import annotations

import secrets
import time
import uuid
from typing import cast

_MILLISECONDS_MASK = (1 << 48) - 1
_UUID7_VERSION = 0x7
_RFC4122_VARIANT = 0b10


def uuid7() -> uuid.UUID:
    """Return a time-ordered UUID v7, using the stdlib factory when available."""
    factory = getattr(uuid, "uuid7", None)
    if callable(factory):
        return cast("uuid.UUID", factory())
    timestamp_ms = int(time.time() * 1000) & _MILLISECONDS_MASK
    rand_a = secrets.randbits(12)
    rand_b = secrets.randbits(62)
    number = (timestamp_ms << 80) | (_UUID7_VERSION << 76) | (rand_a << 64)
    number |= (_RFC4122_VARIANT << 62) | rand_b
    return uuid.UUID(int=number)


def new_id() -> str:
    """Return a lowercase hyphenated UUID v7 string."""
    return str(uuid7())
