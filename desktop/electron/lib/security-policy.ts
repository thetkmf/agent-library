/**
 * 纯函数形式的安全策略，便于单元测试（不依赖 Electron 运行时）。
 */

export const ALLOWED_EXTERNAL_PROTOCOLS = ['https:', 'http:'] as const;

/** 是否允许用系统浏览器打开（仅 http/https） */
export function isAllowedExternalUrl(rawUrl: unknown): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return false;
  }
  try {
    const url = new URL(rawUrl);
    return (ALLOWED_EXTERNAL_PROTOCOLS as readonly string[]).includes(url.protocol);
  } catch {
    return false;
  }
}

export interface NavigationPolicy {
  /** 允许的应用内 origin（开发态 http://127.0.0.1:5173） */
  allowedOrigins: readonly string[];
  /** 生产态允许 file:// 加载打包后的 index.html */
  allowFileProtocol: boolean;
}

/**
 * 判断一次页面级跳转是否留在应用内。
 * 说明：SPA 使用 Hash 路由，hash 变化不会触发 will-navigate，因此这里只放行应用自身。
 */
export function isAllowedNavigation(rawUrl: unknown, policy: NavigationPolicy): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'file:') {
    return policy.allowFileProtocol;
  }
  return policy.allowedOrigins.includes(url.origin);
}

/** 生成后端 API 基地址（与《开发接口标准》2.1 一致） */
export function buildApiBaseUrl(port: number, host = '127.0.0.1'): string {
  return `http://${host}:${port}/api/v1`;
}
