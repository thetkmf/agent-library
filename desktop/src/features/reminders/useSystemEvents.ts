import { useCallback, useEffect, useRef, useState } from 'react';
import { openSseStream } from '@/api/sse';

export interface SystemEvent {
  event: string;
  data: string;
}

/**
 * 订阅系统事件（契约 9.11 `/events/stream`）。
 * 仅在使用方页面挂载时建立连接，卸载即关闭；断线由 sse 客户端自动重连。
 */
export function useSystemEvents(
  onEvent: (event: SystemEvent) => void,
  options: { enabled?: boolean } = {},
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const enabled = options.enabled ?? true;

  const stableHandler = useCallback((event: SystemEvent) => {
    handlerRef.current(event);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const handle = openSseStream('/events/stream', {
      onOpen: () => setConnected(true),
      onEvent: (event) => stableHandler({ event: event.event, data: event.data }),
      onClose: () => setConnected(false),
      maxRetries: 5,
      initialDelayMs: 1_000,
      maxDelayMs: 15_000,
      pauseWhenHidden: true,
    });
    return () => {
      handle.close();
      setConnected(false);
    };
  }, [enabled, stableHandler]);

  return { connected };
}
