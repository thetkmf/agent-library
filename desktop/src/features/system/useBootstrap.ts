import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppBootstrap, BackendStatus } from '@/bridge';
import { createOfflineBootstrap, getBridge } from '@/bridge';

export type BootstrapPhase = 'loading' | 'ready' | 'error';

export interface UseBootstrapResult {
  phase: BootstrapPhase;
  bootstrap: AppBootstrap | null;
  backend: BackendStatus | null;
  error: string | null;
  bridgeAvailable: boolean;
  restarting: boolean;
  reload: () => void;
  restartBackend: () => Promise<void>;
}

/**
 * 建立渲染进程与主进程的一次性握手，并持续订阅后端状态。
 * token 只保存在内存状态里，不写入 localStorage / sessionStorage。
 */
export function useBootstrap(): UseBootstrapResult {
  const [phase, setPhase] = useState<BootstrapPhase>('loading');
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null);
  const [backend, setBackend] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const bridge = getBridge();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    if (!bridge) {
      const offline = createOfflineBootstrap('当前不在桌面应用中运行，无法连接本地后端');
      setBootstrap(offline);
      setBackend(offline.backend);
      setPhase('ready');
      return () => {
        mounted.current = false;
      };
    }

    setPhase('loading');
    setError(null);

    bridge
      .getBootstrap()
      .then((payload) => {
        if (!mounted.current) {
          return;
        }
        setBootstrap(payload);
        setBackend(payload.backend);
        setPhase('ready');
      })
      .catch((reason: unknown) => {
        if (!mounted.current) {
          return;
        }
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase('error');
      });

    const unsubscribe = bridge.onBackendStatus((status) => {
      if (mounted.current) {
        setBackend(status);
      }
    });

    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [bridge, reloadKey]);

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  const restartBackend = useCallback(async () => {
    if (!bridge) {
      return;
    }
    setRestarting(true);
    try {
      const status = await bridge.restartBackend();
      if (mounted.current) {
        setBackend(status);
      }
    } catch (reason: unknown) {
      if (mounted.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (mounted.current) {
        setRestarting(false);
      }
    }
  }, [bridge]);

  return {
    phase,
    bootstrap,
    backend,
    error,
    bridgeAvailable: bridge !== null,
    restarting,
    reload,
    restartBackend,
  };
}
