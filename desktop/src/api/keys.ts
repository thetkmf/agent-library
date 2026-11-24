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
  agent: {
    all: ['agent'] as const,
    conversations: () => [...queryKeys.agent.all, 'conversations'] as const,
    conversation: (id: string) => [...queryKeys.agent.all, 'conversation', id] as const,
    tasksList: () => [...queryKeys.agent.all, 'tasks'] as const,
    tasks: (query: object = {}) => [...queryKeys.agent.tasksList(), query] as const,
    suggestionsList: () => [...queryKeys.agent.all, 'suggestions'] as const,
    suggestions: (query: object = {}) => [...queryKeys.agent.suggestionsList(), query] as const,
  },
  reminders: {
    all: ['reminders'] as const,
    list: (query: object = {}) => [...queryKeys.reminders.all, 'list', query] as const,
  },
  learning: {
    all: ['learning'] as const,
    plans: (query: object = {}) => [...queryKeys.learning.all, 'plans', query] as const,
    progress: () => [...queryKeys.learning.all, 'progress'] as const,
  },
  graph: {
    all: ['graph'] as const,
    data: (query: object = {}) => [...queryKeys.graph.all, 'data', query] as const,
    stats: () => [...queryKeys.graph.all, 'stats'] as const,
  },
  settings: {
    all: ['settings'] as const,
    profile: () => ['settings', 'profile'] as const,
  },
  search: {
    all: ['search'] as const,
    lists: () => [...queryKeys.search.all, 'list'] as const,
    list: (params: object = {}) => [...queryKeys.search.lists(), params] as const,
    indexStatus: () => [...queryKeys.search.all, 'index-status'] as const,
  },
} as const;
