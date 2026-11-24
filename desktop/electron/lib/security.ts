import { app, session, shell } from 'electron';
import type { BrowserWindow, WebContents } from 'electron';
import { isAllowedExternalUrl, isAllowedNavigation, type NavigationPolicy } from './security-policy';

export interface ApplySecurityOptions {
  devServerUrl?: string | undefined;
  isPackaged: boolean;
  /** 渲染进程允许的 CSP 之外的会话加固 */
  onBlocked?: (reason: string, detail: string) => void;
}

/**
 * 统一加固所有 webContents：
 * - 禁止页面跳转到应用外（站内 Hash 路由不受影响）
 * - 新窗口一律拦截，http/https 交给系统浏览器
 * - 禁止 <webview> 挂载
 * - 权限请求默认拒绝，仅允许桌面通知
 */
export function hardenApp(options: ApplySecurityOptions): void {
  const policy: NavigationPolicy = {
    allowedOrigins: [
      ...(options.devServerUrl ? [new URL(options.devServerUrl).origin] : []),
    ],
    allowFileProtocol: true,
  };

  const report = options.onBlocked ?? (() => undefined);

  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
      report('webview_blocked', contents.getURL());
    });

    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url, policy)) {
        event.preventDefault();
        report('navigation_blocked', url);
      }
    });

    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) {
        void shell.openExternal(url);
        report('external_open', url);
      } else {
        report('window_open_blocked', url);
      }
      return { action: 'deny' };
    });
  });
}

/** 会话级权限策略：只放行通知（提醒功能需要），其余一律拒绝 */
export function hardenSession(targetSession: Electron.Session, onDenied?: (permission: string) => void): void {
  targetSession.setPermissionRequestHandler((_contents, permission, callback) => {
    const allowed = permission === 'notifications';
    if (!allowed) {
      onDenied?.(permission);
    }
    callback(allowed);
  });

  // 桌面端不需要任何设备权限
  targetSession.setPermissionCheckHandler((_contents, permission) => permission === 'notifications');
}

/** 窗口级加固：关闭拼写检查（内容不外发），生产态禁止打开调试器 */
export function hardenWindow(window: BrowserWindow, options: { allowDevTools: boolean }): void {
  window.webContents.session.setSpellCheckerEnabled(false);
  if (!options.allowDevTools) {
    window.webContents.on('devtools-opened', () => {
      window.webContents.closeDevTools();
    });
  }
}

export function getDefaultSession(): Electron.Session {
  return session.defaultSession;
}
