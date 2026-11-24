"""Safe path resolution and filename sanitising."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.core.config import Settings
from app.core.errors import AppError
from app.core.paths import build_layout, ensure_layout, resolve_safe_path, sanitize_filename


def test_resolve_inside_base(tmp_path: Path) -> None:
    target = resolve_safe_path(tmp_path, "2026/11/asset/file.txt")
    assert target == (tmp_path / "2026" / "11" / "asset" / "file.txt").resolve()


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "   ",
        "../secret.txt",
        "a/../../b.txt",
        "/etc/passwd",
        "C:\\Windows\\win.ini",
        "bad\x00name.txt",
    ],
)
def test_resolve_rejects_escapes(tmp_path: Path, bad: str) -> None:
    with pytest.raises(AppError):
        resolve_safe_path(tmp_path, bad)


def test_resolve_rejects_base_itself(tmp_path: Path) -> None:
    with pytest.raises(AppError):
        resolve_safe_path(tmp_path, ".")


def test_sanitize_filename_removes_separators() -> None:
    assert sanitize_filename("a/b\\c:d*.md") == "a-b-c-d-.md"


def test_sanitize_filename_rejects_empty() -> None:
    with pytest.raises(AppError):
        sanitize_filename("   ")


def test_sanitize_filename_truncates(tmp_path: Path) -> None:
    cleaned = sanitize_filename("a" * 300 + ".md")
    assert len(cleaned) <= 200
    assert cleaned.endswith(".md")


def test_ensure_layout_creates_directories(tmp_path: Path) -> None:
    layout = ensure_layout(Settings(data_dir=tmp_path / "data", _env_file=None))
    assert layout.files_dir.is_dir()
    assert layout.db_dir.is_dir()
    assert layout.logs_dir.is_dir()
    assert layout.cache_dir.is_dir()
    assert build_layout(Settings(data_dir=tmp_path / "data", _env_file=None)) == layout


@pytest.mark.parametrize("name", ["CON.md", "nul.txt", "COM1", "lpt9.md"])
def test_sanitize_filename_escapes_windows_reserved_names(name: str) -> None:
    assert sanitize_filename(name).startswith("_")


def test_sanitize_filename_keeps_normal_names() -> None:
    assert sanitize_filename("console.md") == "console.md"
