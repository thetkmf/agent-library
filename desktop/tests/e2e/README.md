# E2E（Playwright，F12-3）

关键路径：新建笔记 → 自动保存 → 打标签 → 搜索 → AI 对话 → 提醒。

## 前置

```bash
npm i -D @playwright/test
npx playwright install chromium
```

Electron 启动方式（供 `playwright.config.ts` 使用）：

```ts
// electron.launch({ args: ['.'], env: { ...process.env, PKB_E2E: '1' } })
```

## 说明

- E2E 不依赖真实 DeepSeek：AI 对话与自动化相关用例使用 `VITE_USE_MOCKS=1` 的构建，
  或用测试后端返回固定流。
- 用例需在干净数据目录下运行（`PKB_DATA_DIR` 指向临时目录），避免污染本地数据。
- 当前仓库未安装 Playwright（体积与浏览器下载较大），因此 `npm run e2e` 在安装依赖前会
  提示缺少 `@playwright/test`；这部分在 F12 收尾（安装包验证）时一并完成。
