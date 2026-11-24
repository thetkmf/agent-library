import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * 关键路径 E2E（F12-3）：启动打包后的 Electron，验证骨架与核心页面可达。
 *
 * 更完整的用例（新建笔记→自动保存→打标签→搜索→AI 对话→提醒）在安装
 * Playwright 后按同一模式补充；当前先固定启动与导航基线，避免回归。
 */
let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'pkb-e2e-'));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PKB_DATA_DIR: path.join(userDataDir, 'data') },
  });
  page = await app.firstWindow();
  await page.waitForSelector('#root');
});

test.afterAll(async () => {
  await app?.close();
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

test('首屏渲染导航与后端状态徽标', async () => {
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.getByTestId('backend-status')).toBeVisible();
});

test('导航可达各核心页面', async () => {
  for (const [label, marker] of [
    ['笔记', '全部条目'],
    ['文件', null],
    ['时间轴', null],
    ['检索', '索引状态'],
    ['AI 对话', null],
  ] as const) {
    await page.getByRole('link', { name: new RegExp(label) }).first().click();
    if (marker) {
      await expect(page.getByText(marker, { exact: false }).first()).toBeVisible();
    }
  }
});
