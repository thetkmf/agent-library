# Contributing

感谢你对「个人专属智能知识库」的关注。欢迎提交 Bug 报告、功能建议与 Pull Request。

## 开始之前

- 提交前请先搜索现有 [Issues](https://github.com/thetkmf/agent-library/issues)，避免重复。
- 安全漏洞请不要公开提交 Issue，按 [SECURITY.md](SECURITY.md) 的方式私下报告。
- 参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 开发环境

| 依赖 | 版本 |
| --- | --- |
| Windows | 10/11 x64 |
| Node.js | ≥ 20（推荐 24，见 `.nvmrc`） |
| Python | 3.11 |
| Git | 任意近期版本 |

```powershell
git clone https://github.com/thetkmf/agent-library.git
cd agent-library

cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"

cd ..\desktop
npm ci
npm run dev
```

## 工作流

1. 从 `main` 拉出短生命周期分支，例如 `feat/semantic-filter`、`fix/reminder-timezone`。
2. 修改代码，补充或更新测试。
3. 本地通过质量门禁：
   - 后端：`ruff check .`、`ruff format --check .`、`mypy app`、`pytest`
   - 前端：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`
   - 接口变更：重新导出 `backend/openapi.json` 并运行 `python scripts/export_openapi.py --check`，前端重新生成 `desktop/src/api/generated.ts`
4. 提交 PR，描述变更、动机、测试方式与截图（UI 变更）。
5. 等待 CI 与维护者评审。

## 提交信息

使用 Conventional Commits 风格，例如：

```text
feat(search): 支持按标签过滤检索结果
fix(reminders): 修正跨时区提醒时间
docs(readme): 补充安装说明
chore(ci): 缓存 npm 依赖
```

类型常用：`feat`、`fix`、`docs`、`test`、`refactor`、`perf`、`chore`。

## Pull Request 检查单

- [ ] 变更范围聚焦，未混入无关格式改动
- [ ] 新增/修改行为有测试覆盖
- [ ] 本地质量门禁通过
- [ ] 接口变更已同步 OpenAPI 与前端生成类型
- [ ] 未提交密钥、本地数据、模型、sidecar、安装包或其他构建产物
- [ ] 用户可见变更已更新 README / CHANGELOG（如适用）
- [ ] UI 变更附截图或录屏

## 安全与隐私红线

- 不得提交真实 API Key、访问 token、个人数据或本机日志。
- 不得在测试中调用真实 DeepSeek API；使用假客户端或回放。
- 不得引入遥测、分析 SDK 或默认开启的外部网络请求。
- 外部 AI 调用必须保持「用户配置 + 显式开关」双重门禁。

## 文档

- 接口契约：[`docs/开发接口标准.md`](docs/开发接口标准.md)
- 开发规范：[`docs/开发规范.md`](docs/开发规范.md)
- 协作与任务记录：[`docs/开发过程.md`](docs/开发过程.md)

## 许可证

提交贡献即表示你同意以本项目的 [MIT License](LICENSE) 授权你的贡献。
