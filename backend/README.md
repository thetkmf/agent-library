# 后端服务（FastAPI）

个人专属智能知识库的本地后端。接口约定见 `../docs/开发接口标准.md`，进度见 `../docs/开发过程.md`。

## 开发

```bash
cd backend
uv venv
uv pip install -e ".[dev]"
cp .env.example .env   # 填入 PKB_TOKEN
uv run python -m app.main
```

- 健康检查：`GET /health`（同时提供 `GET /api/v1/health`，无需 token）
- 业务接口：`POST/GET /api/v1/...`，需 `Authorization: Bearer <PKB_TOKEN>`
- 交互文档：`/api/v1/docs`

## 质量门禁

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy app
uv run pytest
python ../scripts/export_openapi.py          # 导出契约
python ../scripts/export_openapi.py --check  # 校验契约是否最新
```

## 启动契约（Electron 主进程注入）

| 环境变量 | 说明 |
| --- | --- |
| `PKB_HOST` | 固定 `127.0.0.1`，非回环地址拒绝启动 |
| `PKB_PORT` | 主进程分配的动态端口 |
| `PKB_TOKEN` | 本地 Bearer token（`PKB_LOCAL_TOKEN` 为开发别名） |
| `PKB_DATA_DIR` | 数据目录 |
| `PKB_LOG_FILE` | 结构化日志文件路径（同时写 stdout） |
| `PKB_LOG_LEVEL` | 日志级别 |

入口为 `python -m app.main`（或 `python -m app`）。

## 目录约定

- `app/core` 配置、日志、错误码、安全、路径
- `app/api` 路由与依赖注入（禁止写业务逻辑）
- `app/services` 业务逻辑（不依赖 Request/Response）
- `app/schemas` Pydantic 契约模型（OpenAPI 唯一来源）
