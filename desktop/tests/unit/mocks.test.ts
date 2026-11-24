import { beforeEach, describe, expect, it } from 'vitest';
import { apiRequest } from '@/api/client';
import { configureApi, resetApiConfig } from '@/api/config';
import { ApiError } from '@/api/errors';
import { listMockItems, resetItemMocks, type MockItem } from '@/mocks/items';
import { createMockFetch, MOCK_BASE_URL } from '@/mocks/router';
import { itemRoutes } from '@/mocks/items';

interface PageData {
  items: MockItem[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

beforeEach(() => {
  resetApiConfig();
  resetItemMocks();
  configureApi({
    baseUrl: MOCK_BASE_URL,
    token: 'mock-token',
    fetchImpl: createMockFetch({ routes: itemRoutes, latencyMs: 0 }),
    sleep: async () => undefined,
    random: () => 0.5,
  });
});

describe('契约 Mock（items）', () => {
  it('GET /items 返回分页信封与种子数据', async () => {
    const page = await apiRequest<PageData>('/items', { query: { page: 1, page_size: 2 } });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.has_more).toBe(true);
    expect(page.items[0]).toHaveProperty('version');
    expect(page.items[0]).toHaveProperty('preview');
  });

  it('POST /items 支持幂等键，重复提交返回同一条', async () => {
    const body = { type: 'note', title: '新笔记', content: '正文', tags: ['测试'] };

    const first = await apiRequest<MockItem>('/items', {
      method: 'POST',
      body,
      idempotencyKey: 'idem-1',
    });
    const second = await apiRequest<MockItem & { idempotent_replay?: boolean }>('/items', {
      method: 'POST',
      body,
      idempotencyKey: 'idem-1',
    });

    expect(second.id).toBe(first.id);
    expect(second.idempotent_replay).toBe(true);
    expect(listMockItems()).toHaveLength(4);
  });

  it('参数校验失败返回 40001 语义', async () => {
    const error = (await apiRequest('/items', {
      method: 'POST',
      body: { type: 'note', title: '   ', content: 'x' },
      retries: 0,
    }).catch((reason: unknown) => reason)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('validation');
    expect(error.message).toContain('title');
  });

  it('正文读取按 text/plain 返回原文', async () => {
    const target = listMockItems()[0] as MockItem;
    const content = await apiRequest<string>(`/items/${target.id}/content`, {
      expect: 'raw',
      responseType: 'text',
      retries: 0,
    });
    expect(content).toContain(target.title.slice(0, 2));
  });

  it('正文保存成功则版本递增并刷新预览', async () => {
    const target = listMockItems()[0] as MockItem;
    const updated = await apiRequest<MockItem>(`/items/${target.id}/content`, {
      method: 'PUT',
      textBody: '# 更新后的标题\n\n新的正文内容',
      query: { expected_version: target.version },
      retries: 0,
    });

    expect(updated.version).toBe(target.version + 1);
    expect(updated.preview).toContain('更新后的标题');
  });

  it('版本不匹配返回 409，且 details 带服务端当前对象', async () => {
    const target = listMockItems()[0] as MockItem;
    const error = (await apiRequest(`/items/${target.id}/content`, {
      method: 'PUT',
      textBody: '并发写入',
      query: { expected_version: target.version + 5 },
      retries: 0,
    }).catch((reason: unknown) => reason)) as ApiError;

    expect(error.kind).toBe('conflict');
    expect(error.isVersionConflict).toBe(true);
    expect((error.details as MockItem).version).toBe(target.version);
    expect((error.details as MockItem).id).toBe(target.id);
  });

  it('未覆盖的路径返回 30001 信封，便于发现 mock 缺口', async () => {
    const error = (await apiRequest('/unknown-path', { retries: 0 }).catch((reason: unknown) => reason)) as ApiError;
    expect(error.kind).toBe('not_found');
    expect(error.message).toContain('Mock 未覆盖');
  });
});
