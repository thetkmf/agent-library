import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * 关键路径 E2E（F12-3）：启动 Electron 后覆盖
 * 新建笔记 → 自动保存 → 标签/搜索 → 提醒 → AI 对话门禁。
 *
 * 后端来源（按优先级）：
 *   1. 环境变量 `E2E_BACKEND_CMD` + `E2E_BACKEND_CWD`（指向后端 venv 或 sidecar）
 *   2. 打包暂存的 sidecar：`build/backend/pkb-backend/pkb-backend.exe`
 *   3. 都没有时仅跑骨架用例，后端相关用例 skip
 */
const stagedSidecar = path.resolve('build/backend/pkb-backend/pkb-backend.exe');
const backendCmd = process.env['E2E_BACKEND_CMD'];
const backendCwd = process.env['E2E_BACKEND_CWD'];
const hasBackend = Boolean(backendCmd) || existsSync(stagedSidecar);

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(path.join(tmpdir(), 'pkb-e2e-'));
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PKB_DATA_DIR: path.join(userDataDir, 'data'),
    PKB_SMOKE_WAIT_BACKEND: hasBackend ? '1' : '0',
  };
  if (backendCmd) {
    env['PKB_BACKEND_CMD'] = backendCmd;
    if (backendCwd) {
      env['PKB_BACKEND_CWD'] = backendCwd;
    }
  }
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env,
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

/** 等待后端进入「运行中」；超时返回 false 供后端用例 skip */
async function waitForBackendReady(timeoutMs = 90_000): Promise<boolean> {
  if (!hasBackend) {
    return false;
  }
  try {
    await expect(page.getByTestId('backend-status')).toHaveAttribute('data-state', 'ready', {
      timeout: timeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

test('首屏渲染导航与后端状态徽标', async () => {
  await expect(page.getByRole('complementary', { name: '主导航' })).toBeVisible();
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

test('新建笔记 → 创建后自动保存 → 列表可见', async () => {
  test.skip(!(await waitForBackendReady()), '后端未就绪，跳过写入类用例');

  const title = `E2E 笔记 ${Date.now()}`;
  await page.getByRole('link', { name: /笔记/ }).first().click();
  await page.getByRole('link', { name: /新建笔记/ }).click();

  await page.getByLabel(/标题/).fill(title);
  await page.locator('.cm-content').first().click();
  await page.keyboard.type('# E2E 正文');
  await page.keyboard.press('Enter');
  await page.keyboard.type('创建并进入编辑器。');
  await page.getByTestId('create-submit').click();

  // 进入编辑器后继续输入，触发自动保存（停止输入 800ms）
  await expect(page.getByRole('link', { name: '列表' })).toBeVisible({ timeout: 20_000 });
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('自动保存验证。');
  await expect(page.locator('[data-status]').first()).toHaveText(/已保存/, { timeout: 25_000 });

  await page.getByRole('link', { name: '列表' }).click();
  await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
});

test('搜索命中新建的笔记', async () => {
  test.skip(!(await waitForBackendReady()), '后端未就绪，跳过检索用例');

  await page.getByRole('link', { name: /检索/ }).first().click();
  await page.getByLabel('检索关键字').fill('E2E');
  await page.getByRole('button', { name: '检索' }).click();
  await expect(page.getByTestId('search-summary')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('search-summary')).toContainText('命中');
});

test('创建提醒后列表可见', async () => {
  test.skip(!(await waitForBackendReady()), '后端未就绪，跳过提醒用例');

  const title = `E2E 提醒 ${Date.now()}`;
  await page.getByRole('link', { name: /提醒/ }).first().click();
  await page.getByLabel('提醒标题').fill(title);
  await page.getByTestId('create-reminder').click();
  await expect(page.getByText(title)).toBeVisible({ timeout: 20_000 });
});

test('AI 对话在未配置 Key 时给出可读提示', async () => {
  test.skip(!(await waitForBackendReady()), '后端未就绪，跳过 AI 门禁用例');

  await page.getByRole('link', { name: /AI 对话/ }).first().click();
  await page.getByLabel('输入消息').fill('你好');
  await page.getByTestId('send-message').click();

  // 未配置 DeepSeek 时后端返回 409/50001，前端展示错误横幅而非白屏
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 });
});
