import { createContext, useContext } from 'react';
import type { UseBootstrapResult } from './useBootstrap';

/** 启动上下文：由 BootstrapProvider 提供，供顶栏与页面读取后端状态 */
export const BootstrapContext = createContext<UseBootstrapResult | null>(null);

export function useBootstrapContext(): UseBootstrapResult {
  const context = useContext(BootstrapContext);
  if (!context) {
    throw new Error('useBootstrapContext 必须在 BootstrapProvider 内使用');
  }
  return context;
}
