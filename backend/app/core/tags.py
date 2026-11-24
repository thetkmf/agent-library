"""Tag name normalisation shared by schemas, services and repositories (§9.3).

Tag names are trimmed, NFC-normalised and limited to 1–50 characters. Duplicate
detection uses ``str.casefold`` so ASCII names such as ``Machine`` / ``machine``
collide as required by the contract.
"""

from __future__ import annotations

import unicodedata

from .errors import validation_failed

TAG_NAME_MAX_LENGTH = 50


def normalize_tag_name(value: str) -> str:
    """Trim and NFC-normalise a tag name."""
    return unicodedata.normalize("NFC", value.strip())


def validate_tag_name(value: str, *, allow_empty: bool = False) -> str:
    """Return the normalised name or raise ``40001`` when it is out of range.

    ``allow_empty`` is used by item payloads where blank tag names are ignored
    for backwards compatibility.
    """
    name = normalize_tag_name(value)
    if not name:
        if allow_empty:
            return ""
        raise validation_failed("标签名不能为空")
    if len(name) > TAG_NAME_MAX_LENGTH:
        raise validation_failed(f"标签名不能超过 {TAG_NAME_MAX_LENGTH} 个字符")
    return name
