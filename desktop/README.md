# 桌面端（Electron + React + TypeScript）

个人专属智能知识库的 Windows 桌面端。前端工作树：`lwc/桌面端页面-high-voltage`。

- 任务看板与进度：`docs/开发过程.md`（`main` 分支，F0–F12）
- 前端任务单（切片/验收/批次）：`docs/开发过程.md` 第 13.20 节
- 接口约定：`docs/开发接口标准.md`
- 代码规范：`docs/开发规范.md`

---

## 1. 环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | **>= 20**（`scripts/dev.mjs` 会校验，低于 20 直接退出） |
| npm | >= 10 |
| 后端 | 可选；未就绪时界面进入「启动失败 / BACKEND_NOT_FOUND」态，不影响前端开发 |

> 仓库内已提供 `.nvmrc`（24）与 `.node-version`（24.18.0），用 nvm/fnm/volta 可自动切换。
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
| `npm run gen:api` | 由 `backend/openapi.json` 生成 `src/api/generated.ts`（接口变更后必须执行） |

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
    api/                    # 客户端（唯一 HTTP 入口）、SSE、错误映射、queryKey、生成的类型
    components/layout/      # AppShell / Sidebar / TopBar
    components/ui/          # 通用组件（Button / Panel / Badge / Empty / Error / Skeleton…）
    features/               # 按领域划分（notes / system / theme / placeholders / 后续 search…）
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

## 7. API 层约定（F2）

| 文件 | 职责 |
| --- | --- |
| `src/api/generated.ts` | 由 `npm run gen:api` 从 `backend/openapi.json` 生成，**禁止手改** |
| `src/api/client.ts` | 唯一 HTTP 入口：注入 token / `X-Request-Id` / 幂等键、超时、重试、信封解包 |
| `src/api/errors.ts` | 错误码 → `ApiError(kind)`、用户可读文案、任意异常归一 |
| `src/api/sse.ts` | 基于 fetch 流的 SSE 客户端（可带 Authorization）：拼帧、心跳、重连、取消 |
| `src/api/keys.ts` | TanStack Query 的 `queryKey` 单一出口 |
| `src/api/queries/` | 领域 hook（当前：`system`），页面只调用 hook |

行为要点（与《开发接口标准》对齐）：

| 项 | 实现 |
| --- | --- |
| 超时 | 默认 30s；AI 接口传 `timeoutMs: AI_TIMEOUT_MS`（120s） |
| 重试 | 仅网络/超时/5xx/限流，且仅幂等请求（GET/DELETE 或带 `Idempotency-Key`），最多 2 次，指数退避 + 抖动 |
| 401 | 通过 IPC 重新读取 token 并重试一次；仍失败进入错误态 |
| 信封 | `{code,message,data,request_id}` 解包；`code !== 0` 抛 `ApiError`；`/health` 用 `expect: 'raw'` |
| 409 | `30003` 标记 `isVersionConflict`，由编辑器提示「刷新/覆盖」（F3） |
| 取消 | 传 `AbortSignal`，取消抛 `kind: 'aborted'` 且不重试 |
| SSE | 网络中断按 1s→2s→4s…（≤15s）重连，最多 5 次；**服务端正常关闭视为完成不重连**；`terminalEvents`（如 `message.completed`）命中后主动结束；页面隐藏时暂停重连 |
| 未就绪 | 后端未启动时 `kind: 'unavailable'`，不发请求 |

## 7.1 契约 Mock（F5 前置）

`/items`（B2）、`/timeline`、`/tags`（B3）已切真实接口，对应 mock 已移出产品代码，
仅保留为 UI 回归测试夹具（`tests/fixtures/`）。`/files`、`/uploads`（B4）未产出前，
仍按《开发过程》13.6 用 mock 驱动：

```bash
VITE_USE_MOCKS=1 npm run dev          # 开发态启用
# 运行态：DevTools 执行 localStorage.setItem('pkb.mock','1') 后刷新
```

- 位置：`src/mocks/`（`README.md` 内有场景索引，按任务 id 对应）；测试夹具在 `tests/fixtures/`
- 只替换 fetch 实现，请求仍走 `src/api/client.ts`，信封/超时/重试/错误映射一致
- 未覆盖路径返回 `30001` 信封并提示，避免静默通过
- B2–B4 合入后：删除对应 mock、`npm run gen:api`、切真实接口

## 8. F1 完成情况

- [x] 应用外壳：左侧分组导航（可折叠、键盘可达、折叠后保留可访问名称）+ 顶栏 + 主内容 + 状态栏
- [x] 路由：HashRouter（适配 `file://`），路由表由 `src/app/nav-items.ts` 驱动，导航与路由不会漂移
- [x] 主题：浅色 / 深色 / 跟随系统，状态存 Zustand 并持久化到 `localStorage`
- [x] 通用组件：Button / IconButton / LinkButton / Panel / StatusBadge / Skeleton / EmptyState / ErrorState
- [x] 状态覆盖：规划中功能给出占位说明与里程碑，未知路径回落兜底页，加载/错误态可重试
- [x] 可访问性：跳转主内容链接、`aria-current`、`role=alert`、`aria-busy`、`prefers-reduced-motion`
- [x] 测试：新增 store / Sidebar / 路由 / 状态组件测试，合计 47 项

## 8.1 F4 时间轴与标签

| 能力 | 实现 |
| --- | --- |
| 分组 | 日 / 周 / 月（ISO 周），按 `tz` 的墙上时间切分；分组标题吸顶（该组标题滚出视口后才显示吸顶条） |
| 虚拟滚动 | `useVirtualWindow` 固定行高 + 二分定位，只渲染可见区间 ± overscan；1 万条（约 101 万行）下窗口 < 20 行 |
| 分页 | `useInfiniteQuery` 游标分页，滚动接近底部自动加载，也可点「加载更多」；跨页同 key 合并、`item_count` 累加（契约 9.2） |
| 筛选 | `type`（可重复）/`status`/`tag_id`/`q`（400ms 防抖）/`created_from`/`created_to`/`group_by`，全部同步到 URL；非法值进入错误态且不发请求 |
| 时区 | 本地 IANA 时区；日期边界按本地 0 点换算成 UTC（`from` 含头、`to` 含尾），覆盖跨年/跨月/ISO 周年边界 |
| 标签 | 标签下拉（含 `item_count`）、按标签筛选、批量添加/移除（逐条调用契约接口） |
| 批量容错 | 逐条调用后汇总 `succeeded/failed`；部分失败只保留失败项，可一键重试 |
| 卡片 | 类型徽标、标题、预览、标签、本地时间；点击进入 `/notes/:id`；选择模式下显示复选框避免误跳转 |

测试覆盖：分组边界（含跨年 ISO 周）、时区换算、筛选解析与 URL 往返、虚拟窗口区间、1 万条性能用例、页面级筛选/批量打标、批量部分失败重试。

## 8.2 F3 编辑器（笔记 / TeX）

| 能力 | 实现 |
| --- | --- |
| 路由 | `/notes`（列表）、`/notes/new`（新建）、`/notes/:itemId`（编辑）；深链接直达，未知 id 显示 404 态 |
| 编辑器 | CodeMirror 6 受控封装（`CodeMirrorEditor`），Markdown / TeX 语法高亮，行号与历史快捷键 |
| 预览 | Markdown 走 `marked` + DOMPurify 白名单净化；TeX 走 KaTeX（`throwOnError`，失败提示不阻塞编辑） |
| 新建 | 类型（note/tex）创建后不可改；`Idempotency-Key` 页面实例内复用，重复点击不会建重复条目（已对真实后端验证回放） |
| 自动保存 | 停止输入 800ms 后保存；`PUT /items/{id}/content?expected_version=` + `text/plain`；串行写（同一时刻仅一个请求），成功更新本地 `version` |
| 版本冲突 | 409/`30003` → 弹窗「使用服务端版本 / 保留本地并覆盖 / 稍后处理」；两条路径都有集成测试 |
| 草稿与离开保护 | 草稿按条目 id + 基线版本存 localStorage；崩溃/刷新后可恢复；有未保存改动时导航二次确认 + `beforeunload` |
| 状态 | 加载骨架 / 空列表 / 错误可重试 / 保存中·已保存·失败·冲突 |

新增依赖（已写入 `desktop/package.json`）：`@codemirror/*`、`marked`、`dompurify`、`katex`。

## 9. F2 完成情况

- [x] `npm run gen:api` 打通，`src/api/generated.ts` 与 `backend/openapi.json` 同步（当前 3 个系统接口）
- [x] `client.ts` 统一入口：信封解包、错误码映射、30s/120s 超时、幂等重试、401 刷新、请求取消
- [x] `errors.ts`：已登记错误码全覆盖映射（认证/冲突/校验/限流/AI/存储）+ 中文兜底文案
- [x] `sse.ts`：拼帧、心跳忽略、指数退避重连、终止事件、页面隐藏暂停、用户取消
- [x] `keys.ts` + `queries/system.ts`：queryKey 单一出口；系统状态页用真实接口自检（`/health`、`/system/info`、`/system/capabilities`）
- [x] 修复：后端后启动时 `api_base_url` 未同步到启动上下文，导致 API 客户端停留在「未就绪」
- [x] 测试：新增 39 项（client/errors/sse/hook），合计 88 项；含真实后端冒烟截图

已知限制（后续任务处理）：

- 后端尚未实现（B0），因此当前状态常为 `BACKEND_NOT_FOUND`；后端就绪后无需改前端即可自动接管
- 打包与安装包（electron-builder + PyInstaller）属于 F12
- 接口类型当前覆盖系统接口与 B2 的 `/items`；后续 B3–B12 完成后重跑 `npm run gen:api` 扩展（B13 固化）
- 检索、AI、提醒、图谱、设置等页面分别由 F6–F11 实现，当前为占位页
- F3 已切真实 `/items`（B2），并按真实契约验证了创建/正文读写/409 冲突/幂等回放
- F4 已切真实 `/timeline`、`/tags`（B3），并验证分组/游标/筛选/标签计数/批量关联与解除
