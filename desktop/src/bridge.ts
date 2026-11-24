import type { AppBootstrap, AppInfo, BackendStatus, PkbBridge } from '@shared/ipc';

declare global {
  interface Window {
    pkb?: PkbBridge;
  }
}

/** 取 preload 暴露的安全桥；在浏览器里直接打开时返回 null */
export function getBridge(): PkbBridge | null {
  return typeof window !== 'undefined' ? window.pkb ?? null : null;
}

/** 渲染进程不在 Electron 容器内运行时的兜底状态，用于给出可读提示 */
export function createOfflineBootstrap(message: string): AppBootstrap {
  const now = new Date().toISOString();
  return {
    app_version: '0.0.0',
    electron_version: '—',
    platform: 'unknown',
    is_dev: false,
    token: '',
    token_secure: false,
    api_base_url: null,
    backend: {
      state: 'failed',
      pid: null,
      port: null,
      api_base_url: null,
      attempts: 0,
      error_code: 'BACKEND_NOT_FOUND',
      error_message: message,
      updated_at: now,
    },
    data_dir: '—',
    log_file: '—',
  };
}

export function createOfflineAppInfo(): AppInfo {
  return {
    app_version: '0.0.0',
    electron_version: '—',
    platform: 'unknown',
    is_dev: false,
    data_dir: '—',
    log_file: '—',
  };
}

export type { AppBootstrap, AppInfo, BackendStatus, PkbBridge };
