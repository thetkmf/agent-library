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

## 8.0 打包与验收（F12/F13）

```bash
npm run stage:artifacts   # 暂存后端 sidecar + 离线模型（校验 sha256，产物不入库）
npm run dist:dir          # 免安装目录（release/win-unpacked）
npm run dist              # NSIS 安装包（release/*.exe）
node scripts/verify-package.mjs release/win-unpacked/PersonalKnowledgeBase.exe
npx playwright test       # 关键路径 E2E（可用 E2E_BACKEND_CMD 指向后端解释器）
```

| 项 | 说明 |
| --- | --- |
| sidecar | 来源默认 `../../后端-test-tube-langchain/backend/dist/pkb-backend`，可用 `--backend` / `PKB_BACKEND_DIST` 覆盖；打进 `resources/backend`，不进 asar |
| 离线模型 | 来源默认 `%LOCALAPPDATA%/pkb-build-cache/bge-small-zh-v1.5`，按 13.23 的 7 项 sha256 校验后打进 `resources/models/bge-small-zh-v1.5` |
| 模型注入 | 打包态主进程设置 `PKB_EMBEDDING_MODEL_DIR`（日志 `embedding.model_dir_injected`），断网首次启动即可用 |
| 验收脚本 | `verify-package.mjs` 直接启动安装目录 exe，通过 IPC 桥取 token 调 `/health`、`/system/capabilities`，输出 backend/embedding/vector 状态 |
| 实测 | 安装包 233 MB；`HF_HUB_OFFLINE=1` 下 `embedding=ready`、`vector.ready=true`、`/health 200` |
| 待办 | 干净 Windows 环境的安装/升级/卸载实测（I6）；安装包未签名 |

## 8.1 F8–F11 概览

| 页面 | 能力 |
| --- | --- |
| 提醒 `/reminders` | 列表（状态筛选/逾期标记）、创建（本地时区→UTC）、重复规则、完成/稍后 10 分钟/取消；订阅 `/events/stream` 的 `reminder.due` 触发桌面通知（权限被拒降级为页内提示） |
| 学习计划 `/learning` | 进度汇总（计划数、完成率、连续学习天数）、计划创建/状态切换（`expected_version`）/删除、里程碑增删与状态联动（done→100%） |
| 知识图谱 `/graph` | 自研确定性力导向布局（纯函数、种子稳定）+ SVG 渲染、`depth/types/limit` 过滤、节点详情与条目跳转、统计卡；>500 节点提示降采样 |
| 设置 `/settings` | DeepSeek 唯一供应商、模型白名单、Key 只写不回显 + `has_key`、连通性测试、外联开关二次确认、自动整理、主题、存储/嵌入信息、画像展示与刷新 |

## 8.2 F7 AI 对话与任务中心（真实契约）

| 能力 | 实现 |
| --- | --- |
| 会话 | 列表/新建/删除；URL `/agent/{id}` 直达，切换会话时以服务端消息为准 |
| 流式对话 | `POST /agent/chat`（SSE over fetch）：`message.started` → 多段 `message.delta` 追加 → `message.completed` 收尾；`terminalEvents` 命中后主动关闭连接 |
| 停止 | 「停止」调用 `close()` → AbortController 取消，已生成内容保留并标记「已停止生成」 |
| 错误与重连 | 网络类错误按 1s→15s 退避重连（≤5 次）；参数/404/401 不重连；失败可一键重试上一问 |
| 渲染 | 助手消息走 Markdown + DOMPurify 白名单净化；用户消息按纯文本保留换行 |
| 引用 | 消息下方引用 chip（标题 + 分数），点击跳 `/notes/:id`（F7-3 继续完善上下文选择器） |
| 状态 | 空会话引导、生成中提示、停止提示、错误提示、会话删除后回到新建态 |

> `/agent/*` 目前由 `src/mocks/agent.ts` 提供（B7 未产出）；B7 合入后删除 mock、重跑 `gen:api`、切真实契约。
> 待办：F7-3 上下文选择器、F7-4 任务中心、F7-5 建议采纳。

## 8.3 F6 检索

| 能力 | 实现 |
| --- | --- |
| 检索入口 | 关键字 300ms 防抖 + 回车立即检索；切模式/筛选时保留上一批结果（`placeholderData`），查询键变化由 React Query 取消上一个请求 |
| 模式 | `keyword` / `semantic` / `hybrid`（默认混合）；服务端降级时展示提示并以实际模式标注 |
| 筛选 | 类型（可多选）、标签；全部同步 URL（可刷新、可前进后退），非法值进入错误态且不发请求 |
| 结果 | 标题 + 类型 + 命中方式（关键词/语义）+ 分数；片段由服务端返回纯文本，前端按词切分后用 `<mark>` 高亮（不注入 HTML） |
| 跳转 | 点击标题进入 `/notes/:id` |
| 索引态 | 显示就绪状态、已索引/待索引、嵌入模型与维度、最近更新时间、任务进度；支持增量/全量重建（202，嵌入不可用时禁用并提示） |
| 状态 | 未输入引导 / 加载骨架 / 无结果 / 错误可重试 / 条件非法可重置 |

> `/search`、`/index/status`、`/index/reindex` 已切真实接口（B6），mock 仅作测试夹具。

## 8.4 F5 文件管理

| 能力 | 实现 |
| --- | --- |
| 上传入口 | 拖拽 + 选择（键盘可达）；扩展名白名单与单文件上限（2 GB）预校验，非法类型给出可读原因 |
| 上传队列 | Zustand 队列，并发 2；进度条（`role=progressbar`）、暂停/继续、取消、失败重试、清理已完成 |
| 小文件 | `POST /files`（multipart，`file/title/tags`），带上传进度（唯一 XHR 通道，仍复用 client 的 URL/鉴权/错误映射） |
| 大文件 | >50 MB 自动分片：`POST /uploads` → 8 MB 分片并发 3 → `complete`；分片按 index 重试（30001/40005 不重试直接提示）、会话内续传、整体 sha256 由 WebCrypto 计算 |
| 列表 | `GET /items?type=file`（契约 13.14）：原始文件名、大小、类型、标签、时间；空/加载/错误态齐全 |
| 下载 | 带鉴权下载 blob，文件名优先取 `Content-Disposition` 的 RFC 5987 字段；不拼本地路径 |
| 预览 | 图片/纯文本走 blob + object URL，关闭即 `revokeObjectURL`；其他类型提示下载查看 |

## 8.5 F4 时间轴与标签

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

## 8.6 F3 编辑器（笔记 / TeX）

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
- F12/F13：安装包已内置 sidecar 与离线模型并实测通过；E2E 6 项跑通；干净环境安装/升级/卸载待 I6
- F3 已切真实 `/items`（B2），并按真实契约验证了创建/正文读写/409 冲突/幂等回放
- F4 已切真实 `/timeline`、`/tags`（B3），并验证分组/游标/筛选/标签计数/批量关联与解除
- F5 已切真实 `/files`、`/uploads`（B4），并验证小文件上传/下载（含 Range）/分片乱序重传/缺片校验/会话过期
