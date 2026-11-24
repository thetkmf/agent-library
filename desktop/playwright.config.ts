import { defineConfig } from '@playwright/test';

/**
 * F12-3 E2E 配置（Electron）。
 *
 * 前置：
 *   npm i -D @playwright/test
 *   npx playwright install chromium
 *
 * 运行：
 *   npm run build && npm run e2e
 *
 * 说明：E2E 使用 `PKB_DATA_DIR` 指向临时目录，避免污染本机数据；
 * AI 相关用例可通过 `VITE_USE_MOCKS=1` 构建后运行，避免真实外联。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
