/**
 * TanStack Query 的 queryKey 统一出口。
 * 禁止在组件或 hook 里散写字符串数组，避免缓存失效/命中的隐式耦合。
 */
export const queryKeys = {
  system: {
    all: ['system'] as const,
    health: () => [...queryKeys.system.all, 'health'] as const,
    info: () => [...queryKeys.system.all, 'info'] as const,
    capabilities: () => [...queryKeys.system.all, 'capabilities'] as const,
  },
} as const;
