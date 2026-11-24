import { useCallback, useEffect, type ReactNode } from 'react';
import { configureApi } from '@/api/config';
import { getBridge } from '@/bridge';
import { BootstrapContext } from './bootstrap-context';
import { useBootstrap } from './useBootstrap';

/**
 * 建立一次 IPC 握手，并把 base URL / token 注入 API 客户端。
 * token 只在内存中流转，不写入任何浏览器存储。
 */
export function BootstrapProvider({ children }: { children: ReactNode }): JSX.Element {
  const value = useBootstrap();
  const baseUrl = value.bootstrap?.api_base_url ?? null;
  const token = value.bootstrap?.token ?? '';

  const refreshCredentials = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) {
      return null;
    }
    const next = await bridge.getBootstrap();
    return { baseUrl: next.api_base_url, token: next.token };
  }, []);

  useEffect(() => {
    configureApi({ baseUrl, token, refreshCredentials });
  }, [baseUrl, token, refreshCredentials]);

  return <BootstrapContext.Provider value={value}>{children}</BootstrapContext.Provider>;
}
