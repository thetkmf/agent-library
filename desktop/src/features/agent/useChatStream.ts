import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, toApiError, userMessageFor } from '@/api/errors';
import {
  openChatStream,
  type ChatStreamHandle,
  type Citation,
  type Role,
} from '@/api/queries/agent';

export interface ChatMessageView {
  id: string;
  role: Role;
  content: string;
  citations: Citation[];
  created_at: string;
  /** 正在流式接收中 */
  pending?: boolean;
  /** 用户主动停止 */
  stopped?: boolean;
}

export interface UseChatStreamOptions {
  conversationId: string | null;
  initialMessages?: ChatMessageView[];
  /** 新建会话时回调（用于更新 URL 与刷新会话列表） */
  onConversationCreated?: (conversationId: string) => void;
  onCompleted?: () => void;
}

export interface UseChatStreamResult {
  messages: ChatMessageView[];
  streaming: boolean;
  error: string | null;
  send: (text: string, contextItemIds?: string[]) => void;
  stop: () => void;
  retryLast: () => void;
  clearError: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 对话流状态机（F7-2）：
 * 发送 → message.started（新会话）→ 多段 message.delta 追加 → message.completed 收尾。
 * 命中终止事件后 sse 客户端主动关闭；用户「停止」调用 close() 立即中断。
 */
export function useChatStream({
  conversationId,
  initialMessages,
  onConversationCreated,
  onCompleted,
}: UseChatStreamOptions): UseChatStreamResult {
  const [messages, setMessages] = useState<ChatMessageView[]>(initialMessages ?? []);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRef = useRef<ChatStreamHandle | null>(null);
  const conversationRef = useRef<string | null>(conversationId);
  const lastSentRef = useRef<{ text: string; history: Array<{ role: Role; content: string }> } | null>(null);
  const messagesRef = useRef<ChatMessageView[]>(messages);
  const lastConversationRef = useRef<string | null>(conversationId);
  /** 服务端消息内容签名：ref 比较不可靠（调用方可能每次新建数组），用签名判定变化 */
  const serverSignature = (initialMessages ?? []).map((message) => `${message.id}:${message.content.length}`).join('|');
  const signatureRef = useRef(serverSignature);
  const initialRef = useRef(initialMessages);
  /** 由本端新建的会话 id：路由切到它时不要清空正在流式输出的本地消息 */
  const createdRef = useRef<string | null>(null);

  messagesRef.current = messages;
  conversationRef.current = conversationId;

  useEffect(() => {
    // 切换会话：以服务端消息为准
    if (lastConversationRef.current !== conversationId) {
      lastConversationRef.current = conversationId;
      initialRef.current = initialMessages;
      signatureRef.current = serverSignature;
      if (createdRef.current === conversationId) {
        // 新会话由本次发送创建：保留本地流式消息，等详情拉取后再对齐
        return;
      }
      setMessages(initialMessages ?? []);
      setError(null);
      return;
    }
    // 同一会话内：仅当服务端消息内容变化、且没有本地未落库消息时才覆盖，
    // 避免流式完成/停止后把本地结果冲掉。
    if (streaming || signatureRef.current === serverSignature) {
      return;
    }
    signatureRef.current = serverSignature;
    if (messagesRef.current.some((message) => message.pending || message.stopped)) {
      return;
    }
    setMessages(initialMessages ?? []);
  }, [conversationId, initialMessages, serverSignature, streaming]);

  useEffect(() => {
    return () => {
      handleRef.current?.close();
      handleRef.current = null;
    };
  }, []);

  const run = useCallback(
    (text: string, history: Array<{ role: Role; content: string }>, contextItemIds: string[] = []) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return;
      }
      setError(null);
      setStreaming(true);

      const userMessage: ChatMessageView = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed,
        citations: [],
        created_at: nowIso(),
      };
      const assistantId = crypto.randomUUID();
      const placeholder: ChatMessageView = {
        id: assistantId,
        role: 'assistant',
        content: '',
        citations: [],
        created_at: nowIso(),
        pending: true,
      };
      setMessages((previous) => [...previous, userMessage, placeholder]);
      lastSentRef.current = { text: trimmed, history };

      const handle = openChatStream(
        {
          conversation_id: conversationRef.current,
          messages: [...history, { role: 'user', content: trimmed }],
          context_item_ids: contextItemIds.length > 0 ? contextItemIds : undefined,
          stream: true,
        },
        {
          onStarted: (payload) => {
            if (!conversationRef.current) {
              conversationRef.current = payload.conversation_id;
              createdRef.current = payload.conversation_id;
              onConversationCreated?.(payload.conversation_id);
            }
          },
          onDelta: (payload) => {
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + payload.delta }
                  : message,
              ),
            );
          },
          onCompleted: (payload) => {
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      pending: false,
                      citations: payload.citations ?? [],
                    }
                  : message,
              ),
            );
            setStreaming(false);
            onCompleted?.();
          },
          onError: (reason) => {
            const apiError = reason instanceof ApiError ? reason : toApiError(reason);
            if (apiError.kind === 'aborted') {
              return;
            }
            setError(userMessageFor(apiError));
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistantId ? { ...message, pending: false } : message,
              ),
            );
            setStreaming(false);
          },
        },
      );
      handleRef.current = handle;
    },
    [onCompleted, onConversationCreated],
  );

  const send = useCallback(
    (text: string, contextItemIds: string[] = []) => {
      const history = messagesRef.current
        .filter((message) => !message.pending && message.content.trim().length > 0)
        .map((message) => ({ role: message.role, content: message.content }));
      run(text, history, contextItemIds);
    },
    [run],
  );

  const stop = useCallback(() => {
    handleRef.current?.close();
    handleRef.current = null;
    setStreaming(false);
    setMessages((previous) =>
      previous.map((message) => (message.pending ? { ...message, pending: false, stopped: true } : message)),
    );
  }, []);

  const retryLast = useCallback(() => {
    const last = lastSentRef.current;
    if (!last) {
      return;
    }
    // 移除上一轮失败/停止的助手占位，避免重复
    setMessages((previous) => previous.filter((message) => !(message.pending || message.stopped)));
    run(last.text, last.history);
  }, [run]);

  const clearError = useCallback(() => setError(null), []);

  return { messages, streaming, error, send, stop, retryLast, clearError };
}
