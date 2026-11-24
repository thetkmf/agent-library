"""Data directory layout and safe path resolution."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .config import Settings
from .errors import illegal_path

MAX_FILENAME_LENGTH = 200
_FORBIDDEN_CHARS = frozenset('<>:"|?*\\' + "".join(chr(code) for code in range(32)))


@dataclass(frozen=True, slots=True)
class DataLayout:
    """Resolved data directories owned by the application."""

    data_dir: Path
    db_dir: Path
    files_dir: Path
    logs_dir: Path
    cache_dir: Path

    @property
    def directories(self) -> tuple[Path, ...]:
        """Return every directory that must exist on disk."""
        return (self.data_dir, self.db_dir, self.files_dir, self.logs_dir, self.cache_dir)


def build_layout(settings: Settings) -> DataLayout:
    """Compute the data layout without touching the filesystem."""
    base = Path(settings.data_dir).expanduser()
    return DataLayout(
        data_dir=base,
        db_dir=base / "db",
        files_dir=base / "files",
        logs_dir=base / "logs",
        cache_dir=base / "cache",
    )


def ensure_layout(settings: Settings) -> DataLayout:
    """Compute the layout and create the directories."""
    layout = build_layout(settings)
    for directory in layout.directories:
        directory.mkdir(parents=True, exist_ok=True)
    return layout


def sanitize_filename(name: str, *, max_length: int = MAX_FILENAME_LENGTH) -> str:
    """Strip path separators and control characters from a user supplied filename."""
    cleaned = "".join("-" if ch in _FORBIDDEN_CHARS or ch in "/\\" else ch for ch in name)
    cleaned = cleaned.strip(" .")
    if not cleaned:
        raise illegal_path("文件名不合法")
    if len(cleaned) <= max_length:
        return cleaned
    suffix = Path(cleaned).suffix
    keep = max(max_length - len(suffix), 1)
    return cleaned[:keep] + suffix


def resolve_safe_path(base: Path, relative: str) -> Path:
    """Resolve `relative` under `base`, rejecting absolute paths and escapes."""
    candidate = relative.strip()
    if not candidate:
        raise illegal_path("路径不能为空")
    if any(ch in _FORBIDDEN_CHARS for ch in candidate):
        raise illegal_path("路径包含非法字符")
    relative_path = Path(candidate)
    if relative_path.is_absolute() or relative_path.drive:
        raise illegal_path("禁止使用绝对路径")
    if any(part in ("..", "") for part in relative_path.parts):
        raise illegal_path("路径不允许包含上级目录")
    base_resolved = base.resolve()
    target = (base_resolved / relative_path).resolve()
    if not target.is_relative_to(base_resolved):
        raise illegal_path("路径越界")
    if target == base_resolved:
        raise illegal_path("路径必须指向文件或子目录")
    return target
