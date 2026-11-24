/**
 * API 运行时配置：base URL 与本地 token 由 Electron 主进程通过 IPC 下发，
 * 禁止在渲染进程里硬编码地址、端口或 token。
 */

export interface ApiCredentials {
  baseUrl: string | null;
  token: string;
}

export interface ApiRuntimeConfig extends ApiCredentials {
  /** 401 时用于重新获取凭据（主进程会重新读取 token） */
  refreshCredentials: (() => Promise<ApiCredentials | null>) | null;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  now: () => number;
}

const DEFAULTS: ApiRuntimeConfig = {
  baseUrl: null,
  token: '',
  refreshCredentials: null,
  fetchImpl: (...args) => fetch(...args),
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
  now: () => Date.now(),
};

let config: ApiRuntimeConfig = { ...DEFAULTS };

export function configureApi(next: Partial<ApiRuntimeConfig>): void {
  config = { ...config, ...next };
}

export function getApiConfig(): ApiRuntimeConfig {
  return config;
}

/** 后端是否已就绪（有 base URL 才允许发请求） */
export function isApiReady(): boolean {
  return typeof config.baseUrl === 'string' && config.baseUrl.length > 0;
}

/** 仅供测试使用：恢复默认配置 */
export function resetApiConfig(): void {
  config = { ...DEFAULTS };
}
