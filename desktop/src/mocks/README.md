# 契约 Mock（F4–F5 前置；条目 mock 已移除）

B2–B4 后端接口未产出前，用与契约同形的 Mock 驱动 UI。规则见《开发过程》13.6。

## 启用方式

```bash
# 构建/开发态：VITE_USE_MOCKS=1 npm run dev
VITE_USE_MOCKS=1 npm run dev

# 运行态调试（无需重新构建）：DevTools 控制台执行后刷新
localStorage.setItem('pkb.mock', '1')
```

未启用时 Mock 完全不生效；启用后只替换 `fetch` 实现，请求仍经过
`src/api/client.ts`（信封解包、超时、重试、错误映射不变）。

## 结构

| 文件 | 作用 |
| --- | --- |
| `router.ts` | fetch 层路由器：方法 + 去前缀路径匹配，支持延迟与回落真实 fetch |
| `envelope.ts` | `ok()` / `fail()` 信封构造，与契约 3.1 / 3.2 一致 |
| `items.ts` | ~~F3 条目与正文接口~~ → 已由 B2 真实接口替代，夹具移至 `tests/fixtures/items-mock.ts` |
| `index.ts` | 路由汇总、启用判断、安装入口 |

## 场景索引（B2 已合入：条目 mock 已删除；B3/B4 合入后继续按 id 删除）

| Mock id | 接口 | 说明 |
| --- | --- | --- |
| `F3/items-list` | `GET /items` | 分页 + `type`/`status`/`q` 过滤 |
| `F3/item-create` | `POST /items` | `note`/`tex` 创建，支持 `Idempotency-Key` |
| `F3/item-get` | `GET /items/{id}` | 不存在返回 `30001` |
| `F3/item-patch` | `PATCH /items/{id}` | 改标题/状态，版本递增 |
| `F3/item-content-read` | `GET /items/{id}/content` | `text/plain`，不走信封 |
| `F3/item-content-write` | `PUT /items/{id}/content` | `expected_version` 校验，冲突 409 + `data` 为当前对象 |
| `F3/item-delete` | `DELETE /items/{id}` | 软删除进回收站 |

## 约定

1. 字段、枚举、错误码只来自《开发接口标准》8.x / 9.x，不新增字段。
2. 未覆盖路径返回 `30001` 信封并提示 `Mock 未覆盖该接口`，避免静默通过。
3. 需要新增 mock 时：在 `items.ts` 或新文件里加路由，并在上表登记 id。
4. 不使用 msw 的 Service Worker：生产态页面以 `file://` 加载，SW 不可用；
   测试与浏览器共用同一份 fetch 实现。
