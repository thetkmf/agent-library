import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { queryKeys } from '@/api/keys';
import type { components } from '@/api/generated';
import { openSseStream } from '@/api/sse';

/**
 * AI 对话（契约 9.6）。B7 尚未产出 `/agent/*`，当前由 `src/mocks/agent.ts` 提供；
 * B7 合入后删除 mock、重跑 `gen:api`，类型换成 generated。
 */
export type Role = 'user' | 'assistant' | 'tool' | 'system';

export interface Citation {
  item_id: string;
  title: string;
  snippet: string;
  score: number;
}

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

export interface ChatRequestBody {
  conversation_id: string | null;
  messages: Array<{ role: Role; content: string }>;
  context_item_ids?: string[];
  stream: true;
}

export const agentApi = {
  conversations: (): Promise<Conversation[]> =>
    apiRequest<Conversation[]>('/agent/conversations', { retries: 0 }),
  conversation: (id: string): Promise<ConversationDetail> =>
    apiRequest<ConversationDetail>(`/agent/conversations/${encodeURIComponent(id)}`, { retries: 0 }),
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
    usage?: { input_tokens: number; output_tokens: number };
  }) => void;
  onError?: (error: unknown) => void;
  onToolCall?: (payload: { name: string; arguments: Record<string, unknown>; result_summary: string }) => void;
}

export interface ChatStreamHandle {
  close: () => void;
  done: Promise<void>;
}

/**
 * 打开对话流（SSE over fetch）。
 * - `terminalEvents: ['message.completed']` 命中后主动结束，避免服务端保持连接时挂死
 * - 网络中断由 sse 客户端按 1s→15s 退避重连，最多 5 次
 * - 用户点「停止」调用 close() → AbortController 取消，服务端随之终止生成
 */
export function openChatStream(
  body: ChatRequestBody,
  handlers: ChatStreamHandlers,
  options: { signal?: AbortSignal } = {},
): ChatStreamHandle {
  const handle = openSseStream('/agent/chat', {
    method: 'POST',
    body,
    signal: options.signal,
    terminalEvents: ['message.completed'],
    maxRetries: 5,
    onOpen: () => undefined,
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
        case 'message.completed':
          handlers.onCompleted?.(
            payload as {
              message_id: string;
              finish_reason: string;
              citations?: Citation[];
            },
          );
          break;
        case 'tool.call':
          handlers.onToolCall?.(
            payload as { name: string; arguments: Record<string, unknown>; result_summary: string },
          );
          break;
        case 'error':
          handlers.onError?.(payload);
          break;
        default:
          break;
      }
    },
    onError: (error) => handlers.onError?.(error),
  });
  return handle;
}

export type GeneratedSchemas = components['schemas'];
