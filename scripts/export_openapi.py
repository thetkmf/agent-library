"""Export the backend OpenAPI schema to backend/openapi.json."""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
OUTPUT_PATH = BACKEND_DIR / "openapi.json"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


def build_schema() -> str:
    """Render the OpenAPI document deterministically."""
    app = create_app(Settings(_env_file=None))
    return json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="导出后端 OpenAPI 契约")
    parser.add_argument("--check", action="store_true", help="只校验已提交的 openapi.json 是否最新")
    args = parser.parse_args(argv)
    content = build_schema()
    if args.check:
        if not OUTPUT_PATH.exists():
            print(f"缺少 {OUTPUT_PATH}，请先导出：python scripts/export_openapi.py")
            return 1
        current = OUTPUT_PATH.read_text(encoding="utf-8")
        if current != content:
            diff = difflib.unified_diff(
                current.splitlines(),
                content.splitlines(),
                fromfile="openapi.json(已提交)",
                tofile="openapi.json(代码生成)",
                lineterm="",
            )
            print("\n".join(list(diff)[:80]))
            print("openapi.json 已过期，请重新导出")
            return 1
        print("openapi.json 与代码一致")
        return 0
    OUTPUT_PATH.write_text(content, encoding="utf-8", newline="\n")
    print(f"已导出 {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
