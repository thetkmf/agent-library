import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { queryKeys } from '@/api/keys';
import type { components } from '@/api/generated';
import { openSseStream } from '@/api/sse';

/**
 * AI 对话 / 任务 / 建议（契约 9.6）。B7、B8 已合入，类型取自 `generated.ts`；
 * 生成类型里带默认值的字段是可选的，这里归一化成稳定形状给 UI 使用。
 */
export type Role = 'user' | 'assistant' | 'tool' | 'system';

export interface Citation {
  item_id: string;
  title: string;
  snippet: string;
  score: number;
}

type RawMessage = components['schemas']['MessageOut'];
type RawConversationSummary = components['schemas']['ConversationSummary'];
type RawConversationPage = components['schemas']['ConversationPage'];
type RawConversationDetail = components['schemas']['ConversationDetail'];

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  citations: Citation[];
  tool_calls: Array<{ name: string; arguments: Record<string, unknown>; result_summary: string }>;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: ChatMessage[];
}

function toCitations(raw: unknown): Citation[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => ({
      item_id: String(entry['item_id'] ?? ''),
      title: String(entry['title'] ?? ''),
      snippet: String(entry['snippet'] ?? ''),
      score: Number(entry['score'] ?? 0),
    }))
    .filter((citation) => citation.item_id.length > 0);
}

function toMessage(raw: RawMessage): ChatMessage {
  return {
    id: raw.id,
    role: (raw.role as Role) ?? 'assistant',
    content: raw.content,
    citations: toCitations(raw.citations),
    tool_calls: Array.isArray(raw.tool_calls)
      ? (raw.tool_calls as ChatMessage['tool_calls'])
      : [],
    created_at: raw.created_at,
  };
}

function toConversation(raw: RawConversationSummary): Conversation {
  return {
    id: raw.id,
    title: raw.title,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

export const agentApi = {
  conversations: async (): Promise<Conversation[]> => {
    const page = await apiRequest<RawConversationPage>('/agent/conversations', {
      query: { page_size: 50 },
      retries: 0,
    });
    return (page.items ?? []).map(toConversation);
  },
  conversation: async (id: string): Promise<ConversationDetail> => {
    const detail = await apiRequest<RawConversationDetail>(
      `/agent/conversations/${encodeURIComponent(id)}`,
      { retries: 0 },
    );
    return {
      ...toConversation(detail),
      messages: (detail.messages ?? []).map(toMessage),
    };
  },
  removeConversation: (id: string): Promise<{ id: string }> =>
    apiRequest<{ id: string }>(`/agent/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      retries: 0,
    }),
};

export function useConversations() {
  return useQuery({
    queryKey: queryKeys.agent.conversations(),
    queryFn: agentApi.conversations,
    retry: false,
    staleTime: 10_000,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: queryKeys.agent.conversation(id ?? ''),
    queryFn: () => agentApi.conversation(id as string),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => agentApi.removeConversation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent.all });
    },
  });
}

export interface ChatStreamHandlers {
  onStarted?: (payload: { conversation_id: string; message_id: string }) => void;
  onDelta?: (payload: { message_id: string; delta: string }) => void;
  onCompleted?: (payload: {
    message_id: string;
    finish_reason: string;
    citations?: Citation[];
    tool_calling?: boolean;
  }) => void;
  onError?: (error: unknown) => void;
}

export interface ChatStreamHandle {
  close: () => void;
  done: Promise<void>;
}

export interface ChatRequestBody {
  conversation_id: string | null;
  messages: Array<{ role: Role; content: string }>;
  context_item_ids?: string[];
  stream: true;
}

/**
 * 对话流（SSE over fetch）：
 * - `terminalEvents: ['message.completed']` 命中后主动结束
 * - 网络类错误退避重连（≤5 次），参数/404/401 不重连
 * - 用户「停止」→ close() 取消，服务端终止上游调用
 */
export function openChatStream(
  body: ChatRequestBody,
  handlers: ChatStreamHandlers,
  options: { signal?: AbortSignal } = {},
): ChatStreamHandle {
  return openSseStream('/agent/chat', {
    method: 'POST',
    body,
    signal: options.signal,
    terminalEvents: ['message.completed'],
    maxRetries: 5,
    onEvent: (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data) as unknown;
      } catch {
        return;
      }
      switch (event.event) {
        case 'message.started':
          handlers.onStarted?.(payload as { conversation_id: string; message_id: string });
          break;
        case 'message.delta':
          handlers.onDelta?.(payload as { message_id: string; delta: string });
          break;
        case 'message.completed': {
          const completed = payload as {
            message_id: string;
            finish_reason: string;
            citations?: unknown;
            tool_calling?: boolean;
          };
          handlers.onCompleted?.({ ...completed, citations: toCitations(completed.citations) });
          break;
        }
        case 'error':
          handlers.onError?.(payload);
          break;
        default:
          break;
      }
    },
    onError: (error) => handlers.onError?.(error),
  });
}

// ---------------------------------------------------------------------------
// AI 任务与建议（契约 9.6 / B8）
// ---------------------------------------------------------------------------

export type AiTask = components['schemas']['AiTaskOut'];
export type AiTaskType = AiTask['type'];
export type AiTaskStatus = AiTask['status'];
export type Suggestion = components['schemas']['SuggestionOut'];

export interface AiTaskInput {
  type: 'organize' | 'summarize' | 'tagging' | 'linking' | 'profile_refresh' | 'graph_build';
  item_ids?: string[];
  options?: Record<string, unknown>;
}

export const tasksApi = {
  list: async (query: { status?: string; type?: string } = {}): Promise<AiTask[]> => {
    const page = await apiRequest<components['schemas']['AiTaskPage']>('/ai/tasks', {
      query: { page_size: 50, status: query.status, type: query.type },
      retries: 0,
    });
    return page.items ?? [];
  },
  get: (id: string): Promise<AiTask> =>
    apiRequest<AiTask>(`/ai/tasks/${encodeURIComponent(id)}`, { retries: 0 }),
  create: (input: AiTaskInput): Promise<AiTask> =>
    apiRequest<AiTask>('/ai/tasks', { method: 'POST', body: input, retries: 0 }),
  cancel: (id: string): Promise<AiTask> =>
    apiRequest<AiTask>(`/ai/tasks/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      retries: 0,
    }),
};

export const suggestionsApi = {
  list: async (query: { status?: string; type?: string } = {}): Promise<Suggestion[]> => {
    const page = await apiRequest<components['schemas']['SuggestionPage']>('/ai/suggestions', {
      query: { page_size: 50, status: query.status, type: query.type },
      retries: 0,
    });
    return page.items ?? [];
  },
  accept: (id: string): Promise<unknown> =>
    apiRequest<unknown>(`/ai/suggestions/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      retries: 0,
    }),
  reject: (id: string): Promise<unknown> =>
    apiRequest<unknown>(`/ai/suggestions/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      retries: 0,
    }),
};

export function useAiTasks(query: { status?: string; type?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.agent.tasks(query),
    queryFn: () => tasksApi.list(query),
    retry: false,
    refetchInterval: 3_000,
    refetchIntervalInBackground: false,
  });
}

export function useAiSuggestions(query: { status?: string; type?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.agent.suggestions(query),
    queryFn: () => suggestionsApi.list(query),
    retry: false,
    staleTime: 10_000,
  });
}

export function useCreateAiTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AiTaskInput) => tasksApi.create(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent.tasksList() });
    },
  });
}

export function useCancelAiTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => tasksApi.cancel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent.tasksList() });
    },
  });
}

export function useDecideSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) =>
      action === 'accept' ? suggestionsApi.accept(id) : suggestionsApi.reject(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent.suggestionsList() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
    },
  });
}
