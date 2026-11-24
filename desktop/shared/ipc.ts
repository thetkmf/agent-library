/**
 * 主进程 ↔ preload ↔ 渲染进程共享的 IPC 契约。
 * 只放类型与常量，不放实现，保证三端引用同一份定义。
 */

/** 后端进程状态机（见《开发接口标准》5.1 与《开发规范》F0 任务） */
export type BackendState =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'failed'
  | 'stopped';

export type BackendErrorCode =
  | 'BACKEND_NOT_FOUND'
  | 'BACKEND_START_FAILED'
  | 'BACKEND_HEALTH_TIMEOUT'
  | 'BACKEND_EXITED';

/** 渲染进程可见的后端状态快照（snake_case，与 HTTP 契约保持一致） */
export interface BackendStatus {
  state: BackendState;
  /** 后端进程 PID，未启动为 null */
  pid: number | null;
  /** 动态分配的回环端口 */
  port: number | null;
  /** 形如 http://127.0.0.1:52341/api/v1，未就绪为 null */
  api_base_url: string | null;
  /** 本次启动已尝试次数，从 1 开始 */
  attempts: number;
  error_code: BackendErrorCode | null;
  error_message: string | null;
  /** ISO 8601 UTC */
  updated_at: string;
}

/** 渲染进程启动所需的全部上下文，由主进程一次性下发 */
export interface AppBootstrap {
  app_version: string;
  electron_version: string;
  platform: string;
  is_dev: boolean;
  /** 本地一次性 token；仅在渲染进程内存中存在，不写入 localStorage */
  token: string;
  /** token 是否以加密方式（safeStorage/DPAPI）落盘 */
  token_secure: boolean;
  api_base_url: string | null;
  backend: BackendStatus;
  data_dir: string;
  log_file: string;
}

export interface AppInfo {
  app_version: string;
  electron_version: string;
  platform: string;
  is_dev: boolean;
  data_dir: string;
  log_file: string;
}

export const IPC_CHANNELS = {
  bootstrap: 'app:bootstrap',
  appInfo: 'app:info',
  backendStatus: 'backend:status',
  backendRestart: 'backend:restart',
  openExternal: 'shell:open-external',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

/** preload 通过 contextBridge 暴露给渲染进程的白名单 API */
export interface PkbBridge {
  readonly channels: readonly IpcChannel[];
  getBootstrap(): Promise<AppBootstrap>;
  getAppInfo(): Promise<AppInfo>;
  restartBackend(): Promise<BackendStatus>;
  openExternal(url: string): Promise<boolean>;
  /** 订阅后端状态变化，返回取消订阅函数 */
  onBackendStatus(listener: (status: BackendStatus) => void): () => void;
}
