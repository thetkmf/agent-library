import type { BrowserWindow } from 'electron';
import type { Logger } from './logger';

export interface SmokeResult {
  has_root: boolean;
  has_title: boolean;
  has_bridge: boolean;
  has_backend_badge: boolean;
}

/**
 * 无头冒烟检查：仅用于 CI / 本地 `npm run smoke`。
 * 校验渲染进程成功挂载、preload 桥可用、首屏文案存在，随后退出进程。
 */
export function runSmokeCheck(window: BrowserWindow, logger: Logger, timeoutMs = 15_000): void {
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

  window.webContents.once('did-finish-load', () => {
    void window.webContents
      .executeJavaScript(
        `(() => {
          const root = document.getElementById('root');
          const text = root ? root.textContent || '' : '';
          return {
            has_root: Boolean(root),
            has_title: text.includes('个人专属智能知识库'),
            has_bridge: typeof window.pkb === 'object' && window.pkb !== null,
            has_backend_badge: text.includes('本地后端'),
          };
        })()`,
        true,
      )
      .then((result: SmokeResult) => {
        clearTimeout(timer);
        logger.info('smoke.result', { ...result });
        const ok =
          result.has_root && result.has_title && result.has_bridge && result.has_backend_badge;
        finish(ok ? 0 : 1);
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
