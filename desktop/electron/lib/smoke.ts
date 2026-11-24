import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Logger } from './logger';

export interface SmokeResult {
  has_root: boolean;
  has_bridge: boolean;
  has_nav: boolean;
  has_backend_badge: boolean;
}

/**
 * 无头冒烟检查：仅用于 CI / 本地 `npm run smoke`。
 * 校验渲染进程成功挂载、preload 桥可用、首屏文案存在，随后退出进程。
 */
export interface SmokeOptions {
  /** 等待后端就绪（PKB_SMOKE_WAIT_BACKEND=1 时生效），便于截取真实联调状态 */
  waitForBackend?: () => Promise<unknown>;
  screenshotPath?: string | undefined;
}

export function runSmokeCheck(
  window: BrowserWindow,
  logger: Logger,
  options: SmokeOptions = {},
  timeoutMs = 20_000,
): void {
  const finish = (code: number): void => {
    setTimeout(() => {
      window.destroy();
      process.exit(code);
    }, 50);
  };

  const timer = setTimeout(() => {
    logger.error('smoke.timeout');
    finish(1);
  }, timeoutMs);

  const waitForBackend = process.env.PKB_SMOKE_WAIT_BACKEND === '1' ? options.waitForBackend : undefined;

  window.webContents.once('did-finish-load', () => {
    void Promise.resolve(waitForBackend?.())
      .then(() => prepareWindow(window, logger))
      .then(() => window.webContents.executeJavaScript(
        `(() => {
          const root = document.getElementById('root');
          const text = root ? root.textContent || '' : '';
          const nav = document.querySelector('nav');
          return {
            has_root: Boolean(root),
            has_bridge: typeof window.pkb === 'object' && window.pkb !== null,
            has_nav: Boolean(nav) && nav.querySelectorAll('a').length >= 8,
            has_backend_badge: Boolean(document.querySelector('[data-testid="backend-status"]')),
          };
        })()`,
        true,
      ))
      .then((result: SmokeResult) => {
        clearTimeout(timer);
        logger.info('smoke.result', { ...result });
        const ok = result.has_root && result.has_bridge && result.has_nav && result.has_backend_badge;
        void captureScreenshot(window, logger, options.screenshotPath).finally(() =>
          finish(ok ? 0 : 1),
        );
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        logger.error('smoke.evaluate_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        finish(1);
      });
  });
}

/** 可选：PKB_SMOKE_SCREENSHOT 指定路径时，把首屏截图落盘，便于人工/CI 留档 */
async function captureScreenshot(
  window: BrowserWindow,
  logger: Logger,
  override?: string,
): Promise<void> {
  const target = override ?? process.env.PKB_SMOKE_SCREENSHOT;
  if (!target) {
    return;
  }
  try {
    // 等待一次合成，避免截到导航前的旧帧
    window.webContents.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const image = await window.webContents.capturePage();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, image.toPNG());
    logger.info('smoke.screenshot', { path: target });
  } catch (error) {
    logger.warn('smoke.screenshot_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 可选：通过真实 UI 交互把窗口切到目标状态，便于截取指定页面。
 * - PKB_SMOKE_ROUTE=/system 点击对应导航链接
 * - PKB_SMOKE_THEME=dark 连续点击主题按钮直到目标主题生效
 */
async function prepareWindow(window: BrowserWindow, logger: Logger): Promise<void> {
  const route = process.env.PKB_SMOKE_ROUTE?.trim();
  if (route) {
    await window.webContents.executeJavaScript(
      `document.querySelector('a[href="${'#'}${route}"]')?.click();`,
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    const state = await window.webContents.executeJavaScript(
      `({ hash: window.location.hash, hrefs: Array.from(document.querySelectorAll('a')).slice(0, 4).map((a) => a.getAttribute('href')) })`,
      true,
    );
    logger.info('smoke.prepare', { route, ...state });
  }

  const theme = process.env.PKB_SMOKE_THEME?.trim();
  if (theme === 'light' || theme === 'dark') {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await window.webContents.executeJavaScript(
        "document.documentElement.dataset['theme'] || 'light';",
        true,
      );
      if (current === theme) {
        return;
      }
      await window.webContents.executeJavaScript(
        "document.querySelector('button[aria-label^=\"切换主题\"]')?.click();",
        true,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}
