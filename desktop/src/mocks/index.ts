import { configureApi, getApiConfig } from '@/api/config';
import { createMockFetch, MOCK_BASE_URL, type MockRoute } from './router';
import { itemRoutes } from './items';

/** 全部 mock 路由；B2–B4 合入后按 id 逐条删除 */
export const mockRoutes: MockRoute[] = [...itemRoutes];

/**
 * 是否启用契约 Mock：
 * - 构建/开发态：`VITE_USE_MOCKS=1`
 * - 运行态调试：localStorage `pkb.mock = '1'`
 */
export function isMockEnabled(): boolean {
  if (import.meta.env['VITE_USE_MOCKS'] === '1') {
    return true;
  }
  try {
    return window.localStorage.getItem('pkb.mock') === '1';
  } catch {
    return false;
  }
}

/**
 * 安装 mock：只替换 fetch 实现，其余（信封、超时、重试、错误映射）仍由 client.ts 处理。
 * 后端未就绪时使用占位 base URL，保证 UI 可独立开发。
 */
export function installMocks(latencyMs = 120): void {
  const config = getApiConfig();
  configureApi({
    fetchImpl: createMockFetch({ routes: mockRoutes, latencyMs, fallback: config.fetchImpl }),
  });
}

/** mock 模式下后端未就绪时回落到占位地址 */
export function resolveApiBaseUrl(baseUrl: string | null): string | null {
  if (baseUrl) {
    return baseUrl;
  }
  return isMockEnabled() ? MOCK_BASE_URL : null;
}

export { MOCK_BASE_URL, createMockFetch };
export type { MockRoute };
