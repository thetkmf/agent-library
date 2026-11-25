"""Entry point for the PyInstaller sidecar (``pkb-backend.exe``).

Electron 主进程负责注入 PKB_PORT / PKB_TOKEN / PKB_DATA_DIR；这里只按 settings 启动服务。
"""

from __future__ import annotations

from app.main import run

if __name__ == "__main__":
    run()
