/**
 * TanStack Query 的 queryKey 统一出口。
 * 禁止在组件或 hook 里散写字符串数组，避免缓存失效/命中的隐式耦合。
 */
export const queryKeys = {
  items: {
    all: ['items'] as const,
    lists: () => [...queryKeys.items.all, 'list'] as const,
    list: (query: object = {}) => [...queryKeys.items.lists(), query] as const,
    details: () => [...queryKeys.items.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.items.details(), id] as const,
    contents: () => [...queryKeys.items.all, 'content'] as const,
    content: (id: string) => [...queryKeys.items.contents(), id] as const,
  },
  system: {
    all: ['system'] as const,
    health: () => [...queryKeys.system.all, 'health'] as const,
    info: () => [...queryKeys.system.all, 'info'] as const,
    capabilities: () => [...queryKeys.system.all, 'capabilities'] as const,
  },
  timeline: {
    all: ['timeline'] as const,
    lists: () => [...queryKeys.timeline.all, 'list'] as const,
    list: (query: object = {}) => [...queryKeys.timeline.lists(), query] as const,
  },
  tags: {
    all: ['tags'] as const,
    list: () => [...queryKeys.tags.all, 'list'] as const,
  },
} as const;
