import { buildUrl } from './client';
import { getApiConfig } from './config';
import { ApiError, displayFallbackFor, kindForHttpStatus, toApiError } from './errors';

export interface SseEvent {
  event: string;
  data: string;
  id: string | null;
}

export interface SseStreamOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  /** 外部取消信号（用户点「停止」时 abort） */
  signal?: AbortSignal;
  onEvent: (event: SseEvent) => void;
  onOpen?: () => void;
  onError?: (error: ApiError) => void;
  onClose?: () => void;
  /** 断线重连次数上限，默认 5 */
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** 页面不可见时暂停重连（契约要求） */
  pauseWhenHidden?: boolean;
  /** 终止事件名（如 message.completed / done），命中后主动结束并关闭连接 */
  terminalEvents?: readonly string[];
}

export interface SseHandle {
  close: () => void;
  done: Promise<void>;
}

/** 按空行切分 SSE 帧，兼容 CRLF；返回未完成的尾部缓冲 */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  return { frames: parts.filter((frame) => frame.trim().length > 0), rest };
}

/** 解析单帧；心跳注释行（`: ping`）会被忽略 */
export function parseEventFrame(frame: string): SseEvent | null {
  let event = 'message';
  let id: string | null = null;
  const data: string[] = [];

  for (const rawLine of frame.split('\n')) {
    if (rawLine.startsWith(':')) {
      continue;
    }
    const separator = rawLine.indexOf(':');
    const field = separator === -1 ? rawLine : rawLine.slice(0, separator);
    const value = separator === -1 ? '' : rawLine.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') {
      event = value.length > 0 ? value : 'message';
    } else if (field === 'data') {
      data.push(value);
    } else if (field === 'id') {
      id = value.length > 0 ? value : null;
    }
  }

  if (data.length === 0) {
    return null;
  }
  return { event, data: data.join('\n'), id };
}

async function waitForVisible(enabled: boolean): Promise<void> {
  if (!enabled || typeof document === 'undefined' || !document.hidden) {
    return;
  }
  await new Promise<void>((resolve) => {
    const onChange = (): void => {
      if (!document.hidden) {
        document.removeEventListener('visibilitychange', onChange);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

interface ConsumeResult {
  /** 本次连接收到的事件数 */
  received: number;
  /** 是否收到终止事件（服务端可能仍保持连接，需要客户端主动结束） */
  terminated: boolean;
}

/** 单次连接：读取事件流直到服务端关闭或命中终止事件 */
async function consumeOnce(
  path: string,
  options: SseStreamOptions,
  signal: AbortSignal,
  onEvent: (event: SseEvent) => void,
): Promise<ConsumeResult> {
  const config = getApiConfig();
  const url = buildUrl(path);
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Request-Id': crypto.randomUUID(),
    ...options.headers,
  };
  if (config.token.length > 0) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await config.fetchImpl(url, {
    method: options.method ?? 'GET',
    headers,
    body,
    signal,
  });

  if (!response.ok) {
    const kind = kindForHttpStatus(response.status);
    throw new ApiError({
      kind,
      code: response.status,
      message: displayFallbackFor(kind),
      httpStatus: response.status,
    });
  }
  if (!response.body) {
    throw new ApiError({
      kind: 'network',
      code: 'SSE_NO_BODY',
      message: '事件流不可读，请重试',
    });
  }

  options.onOpen?.();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const terminals = new Set(options.terminalEvents ?? []);
  let buffer = '';
  let received = 0;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = splitFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        const parsed = parseEventFrame(frame);
        if (!parsed) {
          continue;
        }
        received += 1;
        onEvent(parsed);
        if (terminals.has(parsed.event)) {
          return { received, terminated: true };
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 已结束的连接无需处理
    }
  }

  return { received, terminated: false };
}

/**
 * 打开 SSE 连接：基于 fetch 流（可携带 Authorization 头），
 * 支持指数退避重连、页面隐藏暂停、用户取消。EventSource 无法设置请求头，故不使用。
 */
export function openSseStream(path: string, options: SseStreamOptions): SseHandle {
  const maxRetries = options.maxRetries ?? 5;
  const initialDelayMs = options.initialDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  const pauseWhenHidden = options.pauseWhenHidden ?? true;

  let closed = false;
  let controller: AbortController | null = null;

  const done = (async () => {
    let attempt = 0;
    while (!closed && !options.signal?.aborted) {
      controller = new AbortController();
      const inner = controller.signal;
      const onOuterAbort = (): void => controller?.abort();
      options.signal?.addEventListener('abort', onOuterAbort, { once: true });

      try {
        const result = await consumeOnce(path, options, inner, options.onEvent);
        if (result.received > 0) {
          attempt = 0;
        }
        // 服务端正常结束（或命中终止事件）属于完成，不做重连；
        // 真正的断线会在 reader 读取时抛错，走下面的重连分支。
        break;
      } catch (raw) {
        if (closed || options.signal?.aborted) {
          break;
        }
        const error = toApiError(raw);
        if (error.kind === 'aborted') {
          break;
        }
        options.onError?.(error);
        // 认证失败重连没有意义（token 未变化），直接收尾；
        // 凭据续期由调用方（F7 对话页）处理后再重新开流。
        if (error.kind === 'auth') {
          break;
        }
        if (attempt >= maxRetries) {
          break;
        }
        await waitForVisible(pauseWhenHidden);
        const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** attempt);
        attempt += 1;
        await getApiConfig().sleep(delay);
      } finally {
        options.signal?.removeEventListener('abort', onOuterAbort);
      }
    }
    options.onClose?.();
  })();

  return {
    close: () => {
      closed = true;
      controller?.abort();
    },
    done,
  };
}
