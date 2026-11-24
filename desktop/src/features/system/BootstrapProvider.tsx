import type { ReactNode } from 'react';
import { BootstrapContext } from './bootstrap-context';
import { useBootstrap } from './useBootstrap';

/** 只建立一次 IPC 握手，避免各页面重复调用 getBootstrap */
export function BootstrapProvider({ children }: { children: ReactNode }): JSX.Element {
  const value = useBootstrap();
  return <BootstrapContext.Provider value={value}>{children}</BootstrapContext.Provider>;
}
