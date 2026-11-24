import { ipcMain, shell } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS, type AppBootstrap, type AppInfo, type BackendStatus } from '../../shared/ipc';
import type { BackendManager } from '../lib/backend-process';
import { isAllowedExternalUrl } from '../lib/security-policy';
import type { Logger } from '../lib/logger';

export interface IpcContext {
  getWindow: () => BrowserWindow | null;
  backend: BackendManager;
  getToken: () => string;
  isTokenSecure: () => boolean;
  dataDir: string;
  logFile: string;
  isDev: boolean;
  appVersion: string;
  electronVersion: string;
  platform: string;
  logger: Logger;
}

function assertTrustedSender(context: IpcContext, event: IpcMainInvokeEvent): void {
  const window = context.getWindow();
  if (!window || window.isDestroyed() || event.sender !== window.webContents) {
    throw new Error('FORBIDDEN: 非法 IPC 调用来源');
  }
}

export function createBootstrapPayload(context: IpcContext): AppBootstrap {
  const backend = context.backend.getStatus();
  return {
    app_version: context.appVersion,
    electron_version: context.electronVersion,
    platform: context.platform,
    is_dev: context.isDev,
    token: context.getToken(),
    token_secure: context.isTokenSecure(),
    api_base_url: backend.api_base_url,
    backend,
    data_dir: context.dataDir,
    log_file: context.logFile,
  };
}

export function createAppInfo(context: IpcContext): AppInfo {
  return {
    app_version: context.appVersion,
    electron_version: context.electronVersion,
    platform: context.platform,
    is_dev: context.isDev,
    data_dir: context.dataDir,
    log_file: context.logFile,
  };
}

/** 注册渲染进程可调用的全部通道；返回统一注销函数 */
export function registerIpcHandlers(context: IpcContext): () => void {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();

  handlers.set(IPC_CHANNELS.bootstrap, (event) => {
    assertTrustedSender(context, event);
    return createBootstrapPayload(context);
  });

  handlers.set(IPC_CHANNELS.appInfo, (event) => {
    assertTrustedSender(context, event);
    return createAppInfo(context);
  });

  handlers.set(IPC_CHANNELS.backendRestart, async (event): Promise<BackendStatus> => {
    assertTrustedSender(context, event);
    context.logger.info('ipc.backend_restart');
    return context.backend.restart();
  });

  handlers.set(IPC_CHANNELS.openExternal, async (event, url): Promise<boolean> => {
    assertTrustedSender(context, event);
    if (!isAllowedExternalUrl(url)) {
      context.logger.warn('ipc.open_external_blocked');
      return false;
    }
    await shell.openExternal(url as string);
    return true;
  });

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return () => {
    for (const channel of handlers.keys()) {
      ipcMain.removeHandler(channel);
    }
  };
}

/** 向后端状态订阅者广播（窗口销毁时静默忽略） */
export function broadcastBackendStatus(window: BrowserWindow | null, status: BackendStatus): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }
  window.webContents.send(IPC_CHANNELS.backendStatus, status);
}
