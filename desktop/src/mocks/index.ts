import { configureApi, getApiConfig } from '@/api/config';
import { createMockFetch, MOCK_BASE_URL, type MockRoute } from './router';
/**
 * 当前仍需要的 mock 路由。
 * B2（`/items`）与 B3（`/timeline`、`/tags`）均已合入，条目/时间轴/标签的
 * 产品 mock 已移除，仅保留测试夹具（`tests/fixtures/`）。
 * F6/F7 相关接口均已切真实契约（B6/B7/B8）；产品代码内不再有 mock，
 * 仅保留测试夹具 `tests/fixtures/`。
 */
export const mockRoutes: MockRoute[] = [];

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
