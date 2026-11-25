# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the backend sidecar (B14).

产物：``dist/pkb-backend/``（内含 ``pkb-backend.exe``），Electron 以额外资源方式随包分发。
模型文件不打进包内：首次启动由 ``PKB_EMBEDDING_AUTO_WARMUP=true`` 触发下载。
"""

from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = [("alembic.ini", "."), ("migrations", "migrations")]
binaries = []
hiddenimports = ["uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto",
                 "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on"]

for package in ("chromadb", "fastembed", "onnxruntime"):
    pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hidden

hiddenimports += collect_submodules("alembic")
hiddenimports += collect_submodules("apscheduler")
hiddenimports += collect_submodules("keyring.backends")

block_cipher = None

a = Analysis(
    ["run_backend.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tests", "pytest", "mypy", "ruff", "tkinter", "matplotlib", "IPython"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="pkb-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="pkb-backend",
)
