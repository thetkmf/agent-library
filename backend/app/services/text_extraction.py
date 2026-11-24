"""Plain-text extraction for indexing (§9.5, B5-5)."""

from __future__ import annotations

from pathlib import Path

from ..core.config import Settings
from ..core.logging import get_logger
from ..db.models import Item
from .storage import StorageService

logger = get_logger("pkb.extract")

TEXT_EXTENSIONS = frozenset({"md", "txt", "tex"})
MAX_EXTRACT_BYTES = 2 * 1024 * 1024


def is_extractable_filename(name: str) -> bool:
    """Only markdown / tex / plain text attachments are readable as text."""
    suffix = Path(name).suffix.lower().lstrip(".")
    return suffix in TEXT_EXTENSIONS


def extract_item_text(item: Item, settings: Settings) -> str | None:
    """Return the text to index, or None when the item type is unsupported."""
    if item.type in ("note", "tex"):
        return item.content or ""
    asset = item.file_asset
    if asset is None or not is_extractable_filename(asset.original_name):
        return None
    try:
        path = StorageService(settings).absolute_path(asset.relative_path)
    except Exception:  # pragma: no cover - 路径非法时按不支持处理
        logger.warning("extract.path_rejected")
        return None
    if not path.is_file():
        return None
    with path.open("rb") as handle:
        raw = handle.read(MAX_EXTRACT_BYTES)
    return raw.decode("utf-8", errors="replace")
