# 个人专属智能知识库

本地私有化的个人知识库桌面应用：存储多类型文件、支持向量检索、Markdown 笔记与 TeX 便签，按标签和时间轴组织，并由 AI 完成自动整理、定期提醒、学习规划、进度跟踪、用户画像与知识网络可视化。

## 架构

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Electron + Node.js |
| 前端 | React 18 + TypeScript + Vite |
| 后端 | Python 3.11 + FastAPI |
| Agent | LangChain |
| AI 模型 | DeepSeek（唯一供应商，OpenAI 兼容接口） |
| 数据库 | SQLite + SQLAlchemy + Alembic |
| 向量库 | ChromaDB（嵌入式） |
| 向量嵌入 | BAAI/bge-small-zh-v1.5（本地 ONNX，512 维） |
| 契约 | OpenAPI 3.1（FastAPI 导出） |

## 目录

```
docs/
  开发接口标准.md      # API 约定、资源模型、错误码、接口清单
  开发规范.md          # 前后端编码规范、Git 流程、完成定义
  前后端分工.md        # 三工作树职责与协作边界
  开发过程.md          # 多工作树通信文件：任务状态、契约变更、决策、日志
backend/
  app/                 # FastAPI 服务（core / api / services / schemas）
  tests/               # unit / integration / contract
  openapi.json         # 契约基线，由 scripts/export_openapi.py 生成
scripts/
  check_progress.py    # 开发过程看板检查器（只读）
  export_openapi.py    # 导出/校验后端 OpenAPI 契约
```

## 开发流程

1. 同步 `main`，阅读 [docs/开发过程.md](docs/开发过程.md)。
2. 按 [docs/开发规范.md](docs/开发规范.md) 编码，按 [docs/开发接口标准.md](docs/开发接口标准.md) 对接。
3. 任务状态、接口变更、决策、每日日志只写入 `docs/开发过程.md`。
4. 职责边界见 [docs/前后端分工.md](docs/前后端分工.md)。

## 进度检查

```bash
python scripts/check_progress.py --file docs/开发过程.md
python scripts/check_progress.py --file docs/开发过程.md --json
```

退出码：`0` 正常，`1` 有警告，`2` 有错误。
