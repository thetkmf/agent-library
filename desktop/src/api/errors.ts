/**
 * 错误码与异常体系（契约见《开发接口标准》3.3）。
 * 前端只做映射与展示，不新增错误码。
 */

export const API_ERROR_CODES = {
  ok: 0,
  unknown: 10001,
  notReady: 10002,
  rateLimited: 10003,
  payloadTooLarge: 10004,
  unauthenticated: 20001,
  tokenExpired: 20002,
  forbidden: 20003,
  notFound: 30001,
  conflict: 30002,
  versionConflict: 30003,
  gone: 30004,
  validation: 40001,
  unsupportedQuery: 40002,
  unsupportedFileType: 40003,
  fileTooLarge: 40004,
  chunkInvalid: 40005,
  modelNotConfigured: 50001,
  modelFailed: 50002,
  modelTimeout: 50003,
  contextTooLong: 50004,
  contentBlocked: 50005,
  embeddingFailed: 50006,
  storageWriteFailed: 60001,
  storageFull: 60002,
  invalidPath: 60003,
} as const;

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'unavailable'
  | 'auth'
  | 'conflict'
  | 'not_found'
  | 'validation'
  | 'rate_limit'
  | 'server'
  | 'ai'
  | 'storage'
  | 'unknown';

export interface ApiErrorInit {
  kind: ApiErrorKind;
  /** 契约错误码；网络层错误使用字符串标识（如 `NETWORK_ERROR`） */
  code: number | string;
  message: string;
  httpStatus?: number | null;
  details?: unknown;
  requestId?: string | null;
  /** 是否允许客户端重试（网络抖动、5xx、限流） */
  retryable?: boolean;
  cause?: unknown;
}

/** 统一的前端异常类型：所有 API/SSE 失败都收敛到这里 */
export class ApiError extends Error {
  public readonly kind: ApiErrorKind;
  public readonly code: number | string;
  public readonly httpStatus: number | null;
  public readonly details: unknown;
  public readonly requestId: string | null;
  public readonly retryable: boolean;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.code = init.code;
    this.httpStatus = init.httpStatus ?? null;
    this.details = init.details ?? null;
    this.requestId = init.requestId ?? null;
    this.retryable = init.retryable ?? isRetryableKind(init.kind);
  }

  /** 版本冲突需要前端提示「刷新 / 覆盖」 */
  get isVersionConflict(): boolean {
    return this.code === API_ERROR_CODES.versionConflict;
  }

  get isAuthError(): boolean {
    return this.kind === 'auth';
  }

  toJSON(): Record<string, unknown> {
    return {
      kind: this.kind,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      requestId: this.requestId,
    };
  }
}

/** 错误码 → 语义分类，决定提示样式与是否重试 */
export function kindForCode(code: number): ApiErrorKind {
  if (code >= 20001 && code <= 20003) {
    return 'auth';
  }
  if (code === API_ERROR_CODES.conflict || code === API_ERROR_CODES.versionConflict) {
    return 'conflict';
  }
  if (code === API_ERROR_CODES.notFound || code === API_ERROR_CODES.gone) {
    return 'not_found';
  }
  if (code >= 40001 && code <= 40005) {
    return 'validation';
  }
  if (code === API_ERROR_CODES.rateLimited) {
    return 'rate_limit';
  }
  if (code >= 50001 && code <= 50006) {
    return 'ai';
  }
  if (code >= 60001 && code <= 60003) {
    return 'storage';
  }
  if (code === API_ERROR_CODES.unknown) {
    return 'server';
  }
  if (code >= 10001 && code <= 10004) {
    return 'server';
  }
  return 'unknown';
}

/** HTTP 状态兜底（响应不是标准信封时使用） */
export function kindForHttpStatus(status: number): ApiErrorKind {
  if (status === 401 || status === 403) {
    return 'auth';
  }
  if (status === 404 || status === 410) {
    return 'not_found';
  }
  if (status === 409) {
    return 'conflict';
  }
  if (status === 413) {
    return 'validation';
  }
  if (status === 415 || status === 422) {
    return 'validation';
  }
  if (status === 429) {
    return 'rate_limit';
  }
  if (status === 503) {
    return 'unavailable';
  }
  if (status >= 500) {
    return 'server';
  }
  if (status >= 400) {
    return 'validation';
  }
  return 'unknown';
}

export function isRetryableKind(kind: ApiErrorKind): boolean {
  return kind === 'network' || kind === 'timeout' || kind === 'server' || kind === 'rate_limit';
}

const FALLBACK_MESSAGE: Partial<Record<ApiErrorKind, string>> = {
  network: '无法连接本地后端，请确认后端是否运行',
  timeout: '请求超时，请稍后重试',
  aborted: '请求已取消',
  unavailable: '本地后端尚未就绪',
  auth: '本地凭据无效，请重启桌面端',
  conflict: '数据已被其他窗口修改，请刷新后重试',
  not_found: '资源不存在或已被删除',
  validation: '输入内容不合法，请检查后重试',
  rate_limit: '操作过于频繁，请稍后再试',
  server: '本地后端处理失败，请查看日志',
  ai: 'AI 调用失败，请检查模型配置',
  storage: '本地存储异常，请检查磁盘空间与权限',
  unknown: '操作失败，请稍后重试',
};

/** 优先使用后端中文 message，缺失时按语义兜底 */
export function userMessageFor(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (error instanceof ApiError) {
    if (error.message.trim().length > 0) {
      return error.message;
    }
    return FALLBACK_MESSAGE[error.kind] ?? fallback;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

export function displayFallbackFor(kind: ApiErrorKind): string {
  return FALLBACK_MESSAGE[kind] ?? '操作失败，请稍后重试';
}

/** 任意异常 → ApiError，保证调用方只需处理一种类型 */
const fallbackMessage = '操作失败，请稍后重试';

export function toApiError(cause: unknown): ApiError {
  if (cause instanceof ApiError) {
    return cause;
  }
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return new ApiError({ kind: 'aborted', code: 'ABORTED', message: '请求已取消', cause });
  }
  if (cause instanceof Error) {
    return new ApiError({
      kind: 'network',
      code: 'NETWORK_ERROR',
      message: cause.message || FALLBACK_MESSAGE.network || '无法连接本地后端',
      cause,
    });
  }
  return new ApiError({
    kind: 'unknown',
    code: 'UNKNOWN_ERROR',
    message: typeof cause === 'string' && cause.length > 0 ? cause : FALLBACK_MESSAGE.unknown || fallbackMessage,
    cause,
  });
}
