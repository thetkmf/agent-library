/**
 * 契约 Mock（F3–F5 前置，见《开发过程》13.6）
 *
 * 目的：B2–B4 未产出前，用与契约同形的处理器驱动 UI；B2–B4 合入后逐条删除。
 * 规则：
 * 1. 只做 fetch 层拦截，仍走 `src/api/client.ts`（信封、超时、错误映射不变）。
 * 2. 字段 / 枚举 / 错误码以《开发接口标准》8.x、9.x 为准，禁止自造。
 * 3. 每个路由带 `id`（如 `F3/item-conflict`），便于替换与追溯。
 *
 * 说明：不使用 msw 的 Service Worker —— 生产态页面通过 `file://` 加载，
 * Service Worker 不可用；这里用可注入的 fetch 实现，浏览器与测试同一套代码。
 */

export type MockMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface MockRequest {
  method: MockMethod;
  /** 去掉 `/api/v1` 前缀后的路径，如 `/items/abc` */
  path: string;
  searchParams: URLSearchParams;
  headers: Headers;
  /** 请求体原文（JSON 或 text/plain） */
  text: string;
  /** 客户端取消信号（用于中断 SSE 流等长连接） */
  signal?: AbortSignal;
}

export interface MockResponse {
  status?: number;
  /** JSON 响应体（自动序列化） */
  body?: unknown;
  /** 纯文本响应体（如正文读写） */
  text?: string;
  contentType?: string;
  headers?: Record<string, string>;
  /** 直接返回自定义 Response（如 SSE 流），此时忽略 body/text */
  response?: Response;
}

export type MockHandler = (
  request: MockRequest,
  params: string[],
) => MockResponse | Promise<MockResponse>;

export interface MockRoute {
  /** 场景标识，形如 `F3/item-create`，与任务 ID 对齐便于替换 */
  id: string;
  method: MockMethod;
  /** 作用于去掉前缀的路径 */
  pattern: RegExp;
  handler: MockHandler;
}

export const MOCK_API_PREFIX = '/api/v1';
/** mock 模式下没有真实后端时使用的占位 base URL */
export const MOCK_BASE_URL = `http://mock.local${MOCK_API_PREFIX}`;

export interface CreateMockFetchOptions {
  routes: MockRoute[];
  /** 模拟网络延迟（毫秒），测试传 0 */
  latencyMs?: number;
  /** 未匹配路由时回落到真实 fetch；不传则返回 404 信封 */
  fallback?: typeof fetch;
}

function toResponse(result: MockResponse): Response {
  if (result.response) {
    return result.response;
  }
  const headers = new Headers({ 'X-Request-Id': crypto.randomUUID(), ...result.headers });
  if (result.text !== undefined) {
    headers.set('Content-Type', result.contentType ?? 'text/plain; charset=utf-8');
    return new Response(result.text, { status: result.status ?? 200, headers });
  }
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(result.body ?? null), {
    status: result.status ?? 200,
    headers,
  });
}

export function createMockFetch(options: CreateMockFetchOptions): typeof fetch {
  const latencyMs = options.latencyMs ?? 0;

  return async (input, init) => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl);
    const path = url.pathname.startsWith(MOCK_API_PREFIX)
      ? url.pathname.slice(MOCK_API_PREFIX.length) || '/'
      : url.pathname;
    const method = ((init?.method ?? 'GET') as string).toUpperCase() as MockMethod;

    const request: MockRequest = {
      method,
      path,
      searchParams: url.searchParams,
      headers: new Headers(init?.headers as HeadersInit | undefined),
      text: typeof init?.body === 'string' ? init.body : '',
      signal: init?.signal ?? undefined,
    };

    for (const route of options.routes) {
      if (route.method !== method) {
        continue;
      }
      const matched = route.pattern.exec(path);
      if (!matched) {
        continue;
      }
      if (latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
      }
      return toResponse(await route.handler(request, matched.slice(1)));
    }

    if (options.fallback) {
      return options.fallback(input, init);
    }
    return toResponse({
      status: 404,
      body: {
        code: 30001,
        message: `Mock 未覆盖该接口：${method} ${path}`,
        data: null,
        request_id: crypto.randomUUID(),
      },
    });
  };
}
