import { configureApi, getApiConfig } from './config';
import {
  ApiError,
  displayFallbackFor,
  kindForCode,
  kindForHttpStatus,
  toApiError,
} from './errors';

export const DEFAULT_TIMEOUT_MS = 30_000;
/** AI 相关接口单独放宽超时（契约：默认 30s，AI 120s） */
export const AI_TIMEOUT_MS = 120_000;
export const DEFAULT_RETRIES = 2;
const BACKOFF_BASE_MS = 200;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<string | number | boolean>;

export interface RequestOptions {
  method?: HttpMethod;
  /** JSON 请求体；与 formData / textBody 互斥 */
  body?: unknown;
  /** 纯文本请求体（如 text/plain 正文保存），与 body 互斥 */
  textBody?: string;
  /** 配合 textBody 使用，默认 text/plain; charset=utf-8 */
  contentType?: string;
  formData?: FormData;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 额外重试次数，默认 2（仅幂等请求与可重试错误） */
  retries?: number;
  /** 创建类接口的幂等键 */
  idempotencyKey?: string;
  /** `envelope`（默认）解包统一信封；`raw` 直接返回 JSON（如 /health） */
  expect?: 'envelope' | 'raw';
  responseType?: 'json' | 'text' | 'blob';
}

interface EnvelopeLike {
  code: number;
  message?: string;
  data?: unknown;
  request_id?: string;
  details?: unknown;
}

function isEnvelope(value: unknown): value is EnvelopeLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'number' &&
    'request_id' in (value as object)
  );
}

function parseJson(text: string): unknown {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const { baseUrl } = getApiConfig();
  if (!baseUrl) {
    throw new ApiError({
      kind: 'unavailable',
      code: 'BACKEND_NOT_READY',
      message: '本地后端尚未就绪',
      retryable: false,
    });
  }
  const base = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
    } else {
      params.append(key, String(value));
    }
  }
  const search = params.toString();
  return `${base}${normalizedPath}${search ? `${normalizedPath.includes('?') ? '&' : '?'}${search}` : ''}`;
}

function errorFromPayload(payload: unknown, status: number): ApiError {
  if (isEnvelope(payload)) {
    const kind = kindForCode(payload.code);
    const message = payload.message?.trim();
    return new ApiError({
      kind,
      code: payload.code,
      message: message && message.length > 0 ? message : displayFallbackFor(kind),
      // 契约 4.1/12.3：409 的 data 携带服务端当前对象，需保留给「刷新 / 覆盖」使用
      details: payload.details ?? payload.data ?? null,
      requestId: payload.request_id ?? null,
      httpStatus: status,
    });
  }
  const kind = kindForHttpStatus(status);
  return new ApiError({
    kind,
    code: status,
    message: displayFallbackFor(kind),
    httpStatus: status,
    details: payload,
  });
}

async function performRequest<T>(
  path: string,
  options: RequestOptions,
  timeoutMs: number,
): Promise<T> {
  const config = getApiConfig();
  const url = buildUrl(path, options.query);
  const method: HttpMethod = options.method ?? 'GET';

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onCallerAbort = (): void => controller.abort();
  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  }

  const headers: Record<string, string> = {
    Accept: options.responseType === 'text' ? 'text/plain' : 'application/json',
    'X-Request-Id': crypto.randomUUID(),
    ...options.headers,
  };
  if (config.token.length > 0) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.textBody !== undefined) {
    headers['Content-Type'] = options.contentType ?? 'text/plain; charset=utf-8';
    body = options.textBody;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  try {
    const response = await config.fetchImpl(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    if (options.responseType === 'blob') {
      if (!response.ok) {
        throw errorFromPayload(parseJson(await response.text()), response.status);
      }
      return (await response.blob()) as T;
    }

    const text = await response.text();
    const payload = parseJson(text);

    if (!response.ok) {
      throw errorFromPayload(payload, response.status);
    }
    if (options.responseType === 'text') {
      return text as T;
    }
    if (options.expect === 'raw') {
      return payload as T;
    }
    if (isEnvelope(payload)) {
      if (payload.code !== 0) {
        throw errorFromPayload(payload, response.status);
      }
      return payload.data as T;
    }
    // 兼容免信封接口：保持契约向后兼容
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (timedOut) {
      throw new ApiError({
        kind: 'timeout',
        code: 'TIMEOUT',
        message: `请求超时（${Math.round(timeoutMs / 1000)} 秒）`,
        cause: error,
      });
    }
    if (controller.signal.aborted) {
      throw new ApiError({ kind: 'aborted', code: 'ABORTED', message: '请求已取消', cause: error });
    }
    throw toApiError(error);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }
}

async function refreshCredentials(): Promise<boolean> {
  const { refreshCredentials: refresh } = getApiConfig();
  if (!refresh) {
    return false;
  }
  try {
    const next = await refresh();
    if (!next || !next.token) {
      return false;
    }
    configureApi({ baseUrl: next.baseUrl, token: next.token });
    return true;
  } catch {
    return false;
  }
}

/**
 * 唯一允许的 HTTP 入口：
 * 统一注入 token / X-Request-Id / 超时 / 重试 / 信封解包 / 错误映射。
 * 组件内禁止直接 fetch。
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method: HttpMethod = options.method ?? 'GET';
  const retries = options.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const idempotent = method === 'GET' || method === 'DELETE' || Boolean(options.idempotencyKey);

  let attempt = 0;
  let authRefreshed = false;

  for (;;) {
    try {
      return await performRequest<T>(path, options, timeoutMs);
    } catch (raw) {
      const error = toApiError(raw);

      if (error.isAuthError && !authRefreshed) {
        authRefreshed = true;
        if (await refreshCredentials()) {
          continue;
        }
      }

      if (attempt < retries && error.retryable && idempotent) {
        const config = getApiConfig();
        const jitter = 0.5 + config.random() * 0.5;
        await config.sleep(Math.round(BACKOFF_BASE_MS * 2 ** attempt * jitter));
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
}

export const api = {
  get: <T,>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T,>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T,>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  put: <T,>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  putText: <T,>(
    path: string,
    text: string,
    options: Omit<RequestOptions, 'method' | 'body' | 'textBody'> = {},
  ) => apiRequest<T>(path, { ...options, method: 'PUT', textBody: text }),
  delete: <T,>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// 文件上传 / 下载
// 上传需要进度，fetch 无法读取上传进度，因此这是唯一的 XHR 通道；
// 但 URL、鉴权头、信封解包与错误映射与 apiRequest 完全一致。
// ---------------------------------------------------------------------------

export interface UploadProgress {
  loaded: number;
  total: number;
  /** 0–1，total 未知时为 0 */
  ratio: number;
}

export interface UploadOptions {
  formData: FormData;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (progress: UploadProgress) => void;
}

export function apiUpload<T>(path: string, options: UploadOptions): Promise<T> {
  const config = getApiConfig();
  const url = buildUrl(path);
  const timeoutMs = options.timeoutMs ?? AI_TIMEOUT_MS;

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fail = (error: unknown): void => reject(toApiError(error));

    xhr.open('POST', url, true);
    xhr.timeout = timeoutMs;
    xhr.responseType = 'text';
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Request-Id', crypto.randomUUID());
    if (config.token.length > 0) {
      xhr.setRequestHeader('Authorization', `Bearer ${config.token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (!options.onProgress) {
        return;
      }
      const total = event.lengthComputable ? event.total : 0;
      options.onProgress({
        loaded: event.loaded,
        total,
        ratio: total > 0 ? Math.min(1, event.loaded / total) : 0,
      });
    };

    xhr.onerror = () =>
      fail(new ApiError({ kind: 'network', code: 'NETWORK_ERROR', message: '上传失败，请检查本地后端' }));
    xhr.ontimeout = () =>
      fail(
        new ApiError({
          kind: 'timeout',
          code: 'TIMEOUT',
          message: `上传超时（${Math.round(timeoutMs / 1000)} 秒）`,
        }),
      );
    xhr.onabort = () =>
      fail(new ApiError({ kind: 'aborted', code: 'ABORTED', message: '上传已取消' }));

    xhr.onload = () => {
      const payload = parseJson(xhr.responseText ?? '');
      if (xhr.status >= 200 && xhr.status < 300) {
        if (isEnvelope(payload)) {
          if (payload.code !== 0) {
            reject(errorFromPayload(payload, xhr.status));
            return;
          }
          resolve(payload.data as T);
          return;
        }
        resolve(payload as T);
        return;
      }
      reject(errorFromPayload(payload, xhr.status));
    };

    const onAbort = (): void => xhr.abort();
    if (options.signal?.aborted) {
      reject(new ApiError({ kind: 'aborted', code: 'ABORTED', message: '上传已取消' }));
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    xhr.send(options.formData);
    xhr.onloadend = () => options.signal?.removeEventListener('abort', onAbort);
  });
}

/** 从 `Content-Disposition` 解析文件名，优先 RFC 5987 的 `filename*` */
export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ''));
    } catch {
      return encoded[1].trim().replace(/^"|"$/g, '');
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ? plain[1].trim() : null;
}

export interface DownloadResult {
  blob: Blob;
  filename: string | null;
  contentType: string | null;
  status: number;
}

/** 下载二进制（带鉴权）；错误仍按统一信封解析为 ApiError */
export async function apiDownload(
  path: string,
  options: { signal?: AbortSignal; timeoutMs?: number; range?: string } = {},
): Promise<DownloadResult> {
  const config = getApiConfig();
  const url = buildUrl(path);
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onCallerAbort, { once: true });

  const headers: Record<string, string> = {
    Accept: '*/*',
    'X-Request-Id': crypto.randomUUID(),
  };
  if (config.token.length > 0) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }
  if (options.range) {
    headers['Range'] = options.range;
  }

  try {
    const response = await config.fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    if (!response.ok) {
      throw errorFromPayload(parseJson(await response.text()), response.status);
    }
    return {
      blob: await response.blob(),
      filename: parseContentDispositionFilename(response.headers.get('Content-Disposition')),
      contentType: response.headers.get('Content-Type'),
      status: response.status,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (timedOut) {
      throw new ApiError({ kind: 'timeout', code: 'TIMEOUT', message: '下载超时，请重试', cause: error });
    }
    if (controller.signal.aborted) {
      throw new ApiError({ kind: 'aborted', code: 'ABORTED', message: '下载已取消', cause: error });
    }
    throw toApiError(error);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }
}
