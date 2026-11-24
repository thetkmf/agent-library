# 桌面端（Electron + React + TypeScript）

个人专属智能知识库的 Windows 桌面端。前端工作树：`lwc/桌面端页面-high-voltage`。

- 任务看板与进度：`docs/开发过程.md`（`main` 分支，F0–F12）
- 接口约定：`docs/开发接口标准.md`
- 代码规范：`docs/开发规范.md`

---

## 1. 环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | **>= 20**（`scripts/dev.mjs` 会校验，低于 20 直接退出） |
| npm | >= 10 |
| 后端 | 可选；未就绪时界面进入「启动失败 / BACKEND_NOT_FOUND」态，不影响前端开发 |

> 本机若 `node -v` 仍是 16.x，请把 Node 20+ 的目录放到 PATH 前面，例如：
>
> ```bash
> export PATH="/d/node/node-v24.18.0-win-x64:$PATH"
> ```

依赖安装（Electron 二进制走镜像，避免 GitHub 超时）：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

---

## 2. 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 编译主进程 + 启动 Vite dev server（127.0.0.1:5173）+ 拉起 Electron |
| `npm run build` | 构建渲染进程（`dist/`）与主进程/preload（`dist-electron/`） |
| `npm run typecheck` | 渲染进程与主进程类型检查（strict） |
| `npm run lint` | ESLint |
| `npm test` | Vitest 单元测试 |
| `npm run smoke` | 无头冒烟：构建后启动 Electron，校验挂载 + IPC 桥 + 导航 + 状态徽标，退出码即结果 |
| `npm run gen:api` | 由 `backend/openapi.json` 生成 `src/api/generated.ts`（后端 B13 产出后可用） |

质量门禁顺序：`lint → typecheck → test → build → smoke`。

冒烟脚本可选环境变量（便于留档与后续 E2E）：

| 变量 | 作用 |
| --- | --- |
| `PKB_SMOKE_ROUTE=/system` | 截图前点击对应导航，切到指定页面 |
| `PKB_SMOKE_THEME=dark` | 截图前把主题切到深色（`light` / `dark`） |
| `PKB_SMOKE_SCREENSHOT=<绝对路径>` | 把首屏截图写入指定 PNG |
| `PKB_BACKEND_CMD` / `PKB_BACKEND_CWD` | 指定后端启动命令与工作目录（见第 4 节） |

> 在 Git Bash 里传 `/system` 这类参数时需要 `MSYS_NO_PATHCONV=1`，否则会被改写成 Windows 路径。
>
> 若当前工作树没有 `backend/.venv`，可指向后端工作树的解释器：
>
> ```bash
> BE="../后端-test-tube-langchain/backend"
> PKB_BACKEND_CMD="$(pwd)/$BE/.venv/Scripts/python.exe -m app.main" PKB_BACKEND_CWD="$(pwd)/$BE" npm run dev
> ```

---

## 3. 目录结构

```
desktop/
  electron/                 # 主进程（Node）
    main.ts                 # 应用生命周期、窗口、启动顺序
    preload.ts              # contextBridge 白名单（沙箱 preload，需打包）
    ipc/handlers.ts         # IPC handler 注册 + 来源校验
    lib/
      backend-process.ts    # 后端进程管理：动态端口、token 注入、健康探测、有限重启
      ports.ts              # 空闲回环端口分配
      token-store.ts        # 本地 token 签发/持久化（可注入 SecretBox，便于测试）
      safe-storage.ts       # safeStorage（DPAPI）适配
      security.ts           # 导航/新窗口/权限加固
      security-policy.ts    # 纯函数安全策略（可单测）
      logger.ts             # 结构化 JSON 行日志 + 脱敏
      paths.ts              # userData/logs/data 目录派生
      smoke.ts              # PKB_SMOKE=1 冒烟检查
  shared/ipc.ts             # 主进程/preload/渲染进程共享的 IPC 类型与通道
  src/                      # 渲染进程（Web）
    app/                    # 路由表（导航定义驱动）、应用根组件
    api/                    # F2：客户端、SSE、mappers、生成的类型
    components/layout/      # AppShell / Sidebar / TopBar
    components/ui/          # 通用组件（Button / Panel / Badge / Empty / Error / Skeleton…）
    features/               # 按领域划分（system / theme / placeholders / 后续 notes、search…）
    lib/                    # cn、格式化等工具
    stores/                 # Zustand：UI 状态（主题、侧栏折叠）
    styles/global.css       # 设计令牌（light/dark）+ 基础样式
  scripts/                  # dev / build-electron / smoke
  tests/unit/               # Vitest 单元测试
```

---

## 4. 与后端的进程启动契约（重要）

主进程启动后端进程时通过**环境变量**注入运行参数，后端从环境变量读取（见《开发过程》接口变更记录）：

| 变量 | 含义 |
| --- | --- |
| `PKB_HOST` | 固定 `127.0.0.1`，禁止 `0.0.0.0` |
| `PKB_PORT` | 主进程分配的动态端口 |
| `PKB_TOKEN` | 本地一次性 token，后端用于校验 `Authorization: Bearer` |
| `PKB_DATA_DIR` | 数据目录（SQLite、上传文件、向量库） |
| `PKB_LOG_FILE` | 后端日志应追加写入的文件，便于统一排障 |
| `PKB_LOG_LEVEL` | `debug` / `info` / `warn` / `error` |

健康检查：主进程在 `http://127.0.0.1:{port}` 上依次探测 `/api/v1/health`、`/health`（30 秒超时，最多 3 次重启）。`/health` 不需要鉴权，其余接口必须校验 Bearer token。

启动方式解析优先级：

1. `PKB_BACKEND_CMD`（可配合 `PKB_BACKEND_CWD`）—— 调试任意后端实现
2. 打包态：`resources/backend/pkb-backend.exe`
3. 开发态：仓库根 `backend/app/main.py` 存在时，用 `python -m app.main`（优先 `backend/.venv`，可用 `PKB_PYTHON` 覆盖）
4. 都没有：状态为 `failed` + `BACKEND_NOT_FOUND`，不进入重启循环

---

## 5. 安全边界（默认即生效）

| 项 | 实现 |
| --- | --- |
| 渲染进程沙箱 | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webviewTag: false` |
| IPC | 仅暴露 `getBootstrap` / `getAppInfo` / `restartBackend` / `openExternal` / `onBackendStatus`；主进程校验调用来源 |
| 导航 | 站内 Hash 路由放行；`will-navigate` 拦截跨域跳转；`setWindowOpenHandler` 一律 deny，http/https 交系统浏览器 |
| 权限 | 仅放行 `notifications`（提醒功能），其余拒绝 |
| CSP | `index.html` 由 Vite 插件按环境注入：生产态 `script-src 'self'`、`connect-src` 仅 `http://127.0.0.1:*` |
| token | 32 字节随机，仅内存下发渲染进程；落盘用 `safeStorage`（DPAPI）。界面只显示掩码 |
| 日志 | 结构化 JSON，token 等敏感串登记后统一脱敏；不写用户正文 |
| 外部链接 | 仅 `http` / `https`，经 `shell.openExternal` |

---

## 6. F0 完成情况

- [x] Electron 骨架（main / preload / renderer），主进程与渲染进程分离
- [x] 启动后端进程、动态端口、token 传递（环境变量契约见第 4 节）
- [x] IPC 白名单 + 来源校验，preload 打包（兼容 `sandbox: true`）
- [x] 安全配置：CSP、导航/新窗口拦截、权限策略、日志脱敏
- [x] 首屏展示后端状态、端口、PID、数据目录、日志路径，支持「重启后端」
- [x] 质量门禁：lint / typecheck / 单测（31 项）/ build / 冒烟 全绿

## 7. F1 完成情况

- [x] 应用外壳：左侧分组导航（可折叠、键盘可达、折叠后保留可访问名称）+ 顶栏 + 主内容 + 状态栏
- [x] 路由：HashRouter（适配 `file://`），路由表由 `src/app/nav-items.ts` 驱动，导航与路由不会漂移
- [x] 主题：浅色 / 深色 / 跟随系统，状态存 Zustand 并持久化到 `localStorage`
- [x] 通用组件：Button / IconButton / LinkButton / Panel / StatusBadge / Skeleton / EmptyState / ErrorState
- [x] 状态覆盖：规划中功能给出占位说明与里程碑，未知路径回落兜底页，加载/错误态可重试
- [x] 可访问性：跳转主内容链接、`aria-current`、`role=alert`、`aria-busy`、`prefers-reduced-motion`
- [x] 测试：新增 store / Sidebar / 路由 / 状态组件测试，合计 47 项

已知限制（后续任务处理）：

- 后端尚未实现（B0），因此当前状态常为 `BACKEND_NOT_FOUND`；后端就绪后无需改前端即可自动接管
- 打包与安装包（electron-builder + PyInstaller）属于 F12
- API 客户端、类型生成、SSE 属于 F2；`backend/openapi.json` 已产出，待 B13 完成后执行 `npm run gen:api`
- 各业务页面（笔记、检索、AI、提醒、图谱…）分别由 F3–F11 实现，当前为占位页
