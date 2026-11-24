import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '@/api/client';
import { configureApi, resetApiConfig } from '@/api/config';
import { ApiError, API_ERROR_CODES } from '@/api/errors';

interface RecordedCall {
  url: string;
  init: RequestInit;
}

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function envelope(data: unknown, code = 0, requestId = 'req-1'): Record<string, unknown> {
  return { code, message: code === 0 ? 'ok' : '出错了', data, request_id: requestId };
}

let calls: RecordedCall[];

function setupFetch(impl: FetchImpl): void {
  calls = [];
  configureApi({
    baseUrl: 'http://127.0.0.1:52341/api/v1',
    token: 'local-token',
    fetchImpl: async (input, init) => {
      const requestInit = init ?? {};
      calls.push({ url: String(input), init: requestInit });
      return impl(input, requestInit);
    },
    sleep: async () => undefined,
    random: () => 0.5,
    refreshCredentials: null,
  });
}

beforeEach(() => {
  resetApiConfig();
});

afterEach(() => {
  resetApiConfig();
});

describe('apiRequest 基础行为', () => {
  it('解包统一信封，并注入 token、X-Request-Id 与查询参数', async () => {
    setupFetch(async () => jsonResponse(envelope({ ok: true })));

    const data = await apiRequest<{ ok: boolean }>('/items', {
      query: { page: 1, type: ['note', 'tex'], skip: undefined, empty: null },
    });

    expect(data).toEqual({ ok: true });
    const call = calls[0];
    expect(call).toBeDefined();
    expect(call?.url).toBe('http://127.0.0.1:52341/api/v1/items?page=1&type=note&type=tex');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer local-token');
    expect(headers['X-Request-Id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('JSON 请求体自动带上 Content-Type 与幂等键', async () => {
    setupFetch(async () => jsonResponse(envelope({ id: 'i1' })));

    await apiRequest('/items', {
      method: 'POST',
      body: { title: '笔记' },
      idempotencyKey: 'idem-1',
    });

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toBe('idem-1');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe(JSON.stringify({ title: '笔记' }));
  });

  it('expect=raw 时直接返回裸对象（/health）', async () => {
    setupFetch(async () => jsonResponse({ status: 'ok', version: '0.1.0' }));

    const health = await apiRequest<{ status: string; version: string }>('/health', {
      expect: 'raw',
    });

    expect(health).toEqual({ status: 'ok', version: '0.1.0' });
  });

  it('后端未就绪时抛出 unavailable，不发请求', async () => {
    configureApi({ baseUrl: null });
    setupFetch(async () => jsonResponse(envelope(null)));
    configureApi({ baseUrl: null });

    await expect(apiRequest('/items')).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: false,
    });
    expect(calls).toHaveLength(0);
  });
});

describe('apiRequest 错误映射', () => {
  it('业务错误码映射为 ApiError 并保留 message / request_id', async () => {
    setupFetch(async () => jsonResponse(envelope(null, API_ERROR_CODES.versionConflict, 'req-xyz'), 409));

    const error = await apiRequest('/items/1/content', { method: 'PUT', body: {} }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe(API_ERROR_CODES.versionConflict);
    expect(apiError.kind).toBe('conflict');
    expect(apiError.isVersionConflict).toBe(true);
    expect(apiError.requestId).toBe('req-xyz');
    expect(apiError.httpStatus).toBe(409);
  });

  it('409 冲突把服务端当前对象放在 details（契约 4.1/12.3）', async () => {
    const current = { id: 'i1', title: '标题', version: 5, updated_at: '2026-11-24T04:00:00Z' };
    setupFetch(async () =>
      jsonResponse({ code: API_ERROR_CODES.versionConflict, message: '内容已被修改', data: current, request_id: 'r-1' }, 409),
    );

    const error = (await apiRequest('/items/i1/content', {
      method: 'PUT',
      textBody: '本地正文',
      query: { expected_version: 1 },
    }).catch((reason: unknown) => reason)) as ApiError;

    expect(error.kind).toBe('conflict');
    expect(error.isVersionConflict).toBe(true);
    expect(error.details).toEqual(current);
    expect(error.requestId).toBe('r-1');
  });

  it('textBody 以 text/plain 发送（正文读写接口）', async () => {
    setupFetch(async () => jsonResponse(envelope({ version: 2 })));

    await apiRequest('/items/i1/content', {
      method: 'PUT',
      textBody: '# 正文',
      query: { expected_version: 1 },
    });

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(calls[0]?.init.body).toBe('# 正文');
    expect(calls[0]?.url).toContain('expected_version=1');
  });

  it('非信封错误响应按 HTTP 状态兜底', async () => {
    setupFetch(async () => new Response('<html>boom</html>', { status: 500 }));

    const error = (await apiRequest('/items', { retries: 0 }).catch((reason) => reason)) as ApiError;
    expect(error.kind).toBe('server');
    expect(error.message).toContain('后端');
  });

  it('5xx 幂等请求自动重试后成功', async () => {
    let attempt = 0;
    setupFetch(async () => {
      attempt += 1;
      if (attempt < 3) {
        return jsonResponse(envelope(null, API_ERROR_CODES.unknown), 500);
      }
      return jsonResponse(envelope({ ok: true }));
    });

    const data = await apiRequest<{ ok: boolean }>('/health', { expect: 'envelope' });
    expect(data).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
  });

  it('5xx 重试耗尽后抛错', async () => {
    setupFetch(async () => jsonResponse(envelope(null, API_ERROR_CODES.unknown), 500));

    await expect(apiRequest('/items')).rejects.toMatchObject({ kind: 'server' });
    expect(calls).toHaveLength(3); // 首次 + 2 次重试
  });

  it('4xx 不重试（非幂等、不可重试）', async () => {
    setupFetch(async () => jsonResponse(envelope(null, API_ERROR_CODES.validation), 422));

    await expect(apiRequest('/items', { method: 'POST', body: {} })).rejects.toMatchObject({
      kind: 'validation',
    });
    expect(calls).toHaveLength(1);
  });

  it('401 时刷新一次凭据并重试成功', async () => {
    const refresh = vi.fn(async () => ({ baseUrl: null, token: 'new-token' }));
    let attempt = 0;
    setupFetch(async () => {
      attempt += 1;
      if (attempt === 1) {
        return jsonResponse(envelope(null, API_ERROR_CODES.tokenExpired), 401);
      }
      return jsonResponse(envelope({ ok: true }));
    });
    configureApi({
      baseUrl: 'http://127.0.0.1:52341/api/v1',
      token: 'old-token',
      refreshCredentials: async () => {
        const next = await refresh();
        return { baseUrl: 'http://127.0.0.1:52341/api/v1', token: next.token };
      },
    });

    const data = await apiRequest<{ ok: boolean }>('/items');
    expect(data).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    const secondHeaders = calls[1]?.init.headers as Record<string, string>;
    expect(secondHeaders['Authorization']).toBe('Bearer new-token');
  });

  it('401 且无法刷新时直接失败', async () => {
    setupFetch(async () => jsonResponse(envelope(null, API_ERROR_CODES.unauthenticated), 401));

    await expect(apiRequest('/items')).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toHaveLength(1);
  });
});

describe('apiRequest 超时与取消', () => {
  it('超时按重试次数重试后抛 timeout', async () => {
    setupFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    await expect(apiRequest('/items', { timeoutMs: 20, retries: 2 })).rejects.toMatchObject({
      kind: 'timeout',
    });
    // 超时属于可重试错误：首次 + 2 次重试
    expect(calls).toHaveLength(3);
  });

  it('超时且 retries=0 时只请求一次', async () => {
    setupFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    await expect(apiRequest('/agent/chat', { timeoutMs: 20, retries: 0 })).rejects.toMatchObject({
      kind: 'timeout',
    });
    expect(calls).toHaveLength(1);
  });

  it('调用方取消时抛出 aborted 且不重试', async () => {
    const controller = new AbortController();
    setupFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    const promise = apiRequest('/agent/chat', {
      signal: controller.signal,
      retries: 2,
      timeoutMs: 5_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();

    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
    expect(calls).toHaveLength(1);
  });
});
