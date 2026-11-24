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

## 接口（已实现）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/items` | 列表：过滤 `type/tag_id/status/q/created_from/created_to`，分页 `page/page_size`，排序 `sort/order` |
| POST | `/items` | 创建 note/tex/file；`Idempotency-Key` 支持 24h 重放 |
| GET | `/items/{id}` | 详情（含回收站条目） |
| PATCH | `/items/{id}` | 改标题/标签/状态，`expected_version` 或 `If-Match` 乐观锁 |
| DELETE | `/items/{id}` | 软删除进回收站（幂等） |
| POST | `/items/{id}/restore` | 从回收站恢复 |
| GET | `/items/{id}/content` | 正文原文，`text/plain`，不使用信封 |
| PUT | `/items/{id}/content?expected_version=N` | 正文保存，返回 `ItemOut`，版本递增 |

| GET | `/tags` | 标签列表，含 `item_count`（只统计 active 且未删除条目） |
| POST | `/tags` | 创建标签：trim + NFC，ASCII 不区分大小写判重（重复 409 + 30002） |
| PATCH | `/tags/{id}` | 重命名标签 |
| DELETE | `/tags/{id}` | 删除标签并级联解除关联（条目保留） |
| POST | `/items/{id}/tags` | 批量关联标签（幂等，未知标签 404） |
| DELETE | `/items/{id}/tags/{tag_id}` | 解除单个标签关联 |
| GET | `/timeline` | 时间轴分组：`from/to`、`group_by=day/week/month`、`tz`、`cursor`、`limit`，并支持 `type/status/tag_id/q`（默认 `status=active`） |

## 数据层（B1）

- 数据库：SQLite，文件位于 `<PKB_DATA_DIR>/db/pkb.sqlite3`；连接时开启 `foreign_keys`、`WAL`、`busy_timeout`。
- 迁移：Alembic，脚本在 `migrations/`；应用启动时自动 `upgrade head`（`PKB_AUTO_MIGRATE=false` 可关闭）。
- 手动执行：`uv run alembic upgrade head`、`uv run alembic check`（校验模型与库是否漂移）、`uv run alembic revision --autogenerate -m "..."`。
- 表：`items`、`tags`、`item_tags`、`file_assets`、`ai_tasks`、`conversations`、`messages`、`reminders`、`learning_plans`、`milestones`、`graph_nodes`、`graph_edges`、`user_profiles`、`app_settings`。
- 约定：时间统一存 UTC（读出来带时区）、软删除用 `items.deleted_at`、可编辑资源带 `version` 乐观锁。

## 启动契约（Electron 主进程注入）

| 环境变量 | 说明 |
| --- | --- |
| `PKB_HOST` | 固定 `127.0.0.1`，非回环地址拒绝启动 |
| `PKB_PORT` | 主进程分配的动态端口 |
| `PKB_TOKEN` | 本地 Bearer token（`PKB_LOCAL_TOKEN` 为开发别名） |
| `PKB_DATA_DIR` | 数据目录 |
| `PKB_LOG_FILE` | 结构化日志文件路径（同时写 stdout） |
| `PKB_LOG_LEVEL` | 日志级别 |
| `PKB_AUTO_MIGRATE` | 启动时是否自动迁移（默认 `true`） |
| `PKB_DATABASE_URL` | 覆盖数据库地址（测试用） |

入口为 `python -m app.main`（或 `python -m app`）。

## 目录约定

- `app/core` 配置、日志、错误码、安全、路径
- `app/api` 路由与依赖注入（禁止写业务逻辑）
- `app/services` 业务逻辑（不依赖 Request/Response）
- `app/schemas` Pydantic 契约模型（OpenAPI 唯一来源）
