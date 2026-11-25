# 打包资源

| 文件/目录 | 用途 | 是否入库 |
| --- | --- | --- |
| `icon.ico` / `icon.png` | 应用图标（256×256，脚本生成） | 是 |
| `README.md`、`STAGED.json`（生成） | 说明与暂存记录 | README 入库，STAGED.json 忽略 |
| `backend/pkb-backend/` | 后端 PyInstaller sidecar（构建时暂存） | 否 |
| `models/bge-small-zh-v1.5/` | 离线嵌入模型（构建时暂存，校验 13.23 的 sha256） | 否 |

## 暂存与打包

```bash
npm run stage:artifacts          # 复制 sidecar + 模型（默认路径见脚本注释）
npm run dist:dir                 # stage + 打包到 release/（免安装目录）
npm run dist                     # stage + 产出 NSIS 安装包
```

- sidecar 来源默认 `../../后端-test-tube-langchain/backend/dist/pkb-backend`，可用
  `--backend <dir>` 或 `PKB_BACKEND_DIST` 覆盖。
- 模型来源默认 `%LOCALAPPDATA%/pkb-build-cache/bge-small-zh-v1.5`，可用
  `--model <dir>` 或 `PKB_MODEL_DIR` 覆盖；`--skip-model` 可跳过。
- `extraResources` 会把两者放到安装目录 `resources/backend`、`resources/models`，不进 asar。
