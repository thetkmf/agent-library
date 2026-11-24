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

| POST | `/files` | 小文件上传（multipart：`file`/`title`/`tags`），≤50 MB，返回 `{item, file_asset}` |
| GET | `/files/{asset_id}/download` | 下载/预览：200 或 206（Range）+ `Content-Range` + RFC 5987 文件名 |

上传限制：扩展名白名单（md/tex/txt/pdf/docx/pptx/xlsx/png/jpg/webp/svg/mp3/wav/mp4/zip）、MIME 与扩展名明显不符拒绝、文件名清洗后为空拒绝；超限 `40004`、类型不支持 `40003`；失败整体回滚且不留孤儿文件。

| POST | `/uploads` | 初始化分片上传：`{original_name, size_bytes, mime_type, sha256, title?, tags?}` → `{upload_id, chunk_size, chunk_count}` |
| PUT | `/uploads/{upload_id}/chunks/{index}` | 上传分片（`application/octet-stream`，可乱序/重传），返回 `{index, sha256}` |
| POST | `/uploads/{upload_id}/complete` | 校验缺片与整体 sha256 后组装为文件条目，幂等返回 `{item, file_asset}` |

分片默认 8 MB（5–20 MB 可配），会话 24 小时过期（`30001`），缺片/校验失败 `40005`，启动时清理过期会话。

| POST | `/index/reindex` | `{"mode": "incremental"|"full"}` → 202 `{task_id,type,status,progress}`；已有任务 409 + 30002（data 为当前任务）；模型未就绪 409 + 50001 |
| GET | `/index/status` | `{ready, indexed_count, pending_count, last_updated_at, embedding, task}` |

索引规则：note/tex 全量；file 仅 md/txt/tex 抽取正文（其他 `skipped`）；请求路径只把 `embedding_status` 置 `pending`，真正嵌入在后台任务里；删除条目同时清理向量；`full` 会清理孤儿块。

| GET | `/search` | `q`（1–200 字）、`mode=keyword|semantic|hybrid`（默认 hybrid）、`limit`（默认 20，最大 100）、`type`、`tag_id`；返回 `{items:[{item,score,snippet,match_type}], total, mode, degraded}` |

检索实现：关键词走 FTS5（trigram，中文可子串；短词回退 LIKE + 出现次数打分，bm25 归一化到 0–1）；语义走 Chroma top-K 并按条目去重；混合用 RRF（k=60）融合后再归一化，排序 `score DESC, id DESC`；嵌入不可用时 `semantic/hybrid` 自动降级关键词并置 `degraded=true`。10k 条量级实测：关键词 43 ms、语义 top30 8 ms、混合 37 ms。

| POST | `/agent/chat` | `{conversation_id?, messages, context_item_ids?, stream}`；仅 `stream=true`，SSE 事件 `message.started`/`message.delta`/`message.completed`/`error`，15s 心跳注释 |
| GET | `/agent/conversations` | 分页 `{items,page,page_size,total,has_more}`，`updated_at DESC` |
| GET | `/agent/conversations/{id}` | 会话详情，消息 `created_at ASC` |
| DELETE | `/agent/conversations/{id}` | 硬删除并级联消息 |

Agent 约定：Key 从 `PKB_DEEPSEEK_API_KEY` 或 Windows 凭据管理器读取，`privacy.allow_external_calls` 未开或没有 Key → 409 + `50001` 且不发请求；只读工具 `search_knowledge`/`get_item`/`get_item_content`/`list_tags`，工具循环上限 4 轮；`citations` 按 `item_id` 去重最多 10 条；客户端断开即终止上游且不写 assistant 消息；测试全部使用假客户端，零外联。

## 向量（B5a）

- 依赖：`chromadb`（持久化，数据目录 `chroma/`）、`fastembed` + `onnxruntime`（本地推理 `bge-small-zh-v1.5`，512 维）。
- 惰性加载：模型未下载时 `embedding.status=missing`，服务照常启动；首次重建索引时才加载/下载模型。
- 可配置：`PKB_EMBEDDING_MODEL_DIR`（校验 `model.onnx` sha256）、`PKB_EMBEDDING_BATCH_SIZE`、`PKB_EMBEDDING_MAX_WORKERS`、`PKB_CHUNK_CHARS`/`PKB_CHUNK_OVERLAP_CHARS`。
- 测试使用确定性哈希嵌入器，不联网、不加载真实模型。

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
