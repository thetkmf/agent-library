import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, Send, Square, Trash2 } from 'lucide-react';
import { userMessageFor } from '@/api/errors';
import { queryKeys } from '@/api/keys';
import {
  useConversation,
  useConversations,
  useDeleteConversation,
  type Citation,
} from '@/api/queries/agent';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/format';
import { renderMarkdown } from '@/features/notes/markdown';
import { useChatStream, type ChatMessageView } from './useChatStream';

function CitationList({ citations }: { citations: Citation[] }): JSX.Element | null {
  if (citations.length === 0) {
    return null;
  }
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="引用来源">
      {citations.map((citation) => (
        <li key={`${citation.item_id}-${citation.title}`}>
          <Link
            to={`/notes/${citation.item_id}`}
            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted hover:border-accent/40 hover:text-accent"
            title={citation.snippet}
          >
            {citation.title} · {citation.score.toFixed(2)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function MessageBubble({ message }: { message: ChatMessageView }): JSX.Element {
  const isUser = message.role === 'user';
  const html = useMemo(
    () => (isUser ? '' : renderMarkdown(message.content)),
    [isUser, message.content],
  );

  return (
    <li className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg border px-3 py-2 text-sm',
          isUser
            ? 'border-accent/30 bg-accent/10 text-content'
            : 'border-border bg-elevated text-content',
        )}
        data-testid={isUser ? 'message-user' : 'message-assistant'}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : message.content.length > 0 ? (
          <article
            className="prose-pkb max-w-none leading-relaxed"
            // renderMarkdown 已经过 DOMPurify 白名单净化
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <p className="text-xs text-muted">{message.pending ? '正在生成…' : '（无内容）'}</p>
        )}

        {message.pending ? (
          <p className="mt-1 text-[11px] text-accent" role="status">
            生成中…
          </p>
        ) : null}
        {message.stopped ? <p className="mt-1 text-[11px] text-warning">已停止生成</p> : null}
        {!isUser ? <CitationList citations={message.citations} /> : null}
      </div>
    </li>
  );
}

function ChatComposer({
  streaming,
  onSend,
  onStop,
}: {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}): JSX.Element {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = (): void => {
    const text = value.trim();
    if (text.length === 0 || streaming) {
      return;
    }
    onSend(text);
    setValue('');
    textareaRef.current?.focus();
  };

  return (
    <div className="flex items-end gap-2 rounded-lg border border-border bg-elevated px-2 py-2">
      <textarea
        ref={textareaRef}
        aria-label="输入消息"
        placeholder="输入问题，Enter 发送，Shift+Enter 换行"
        value={value}
        rows={2}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        className="max-h-32 min-h-[44px] flex-1 resize-y bg-transparent px-2 py-1 text-sm text-content outline-none"
      />
      {streaming ? (
        <Button size="sm" variant="secondary" onClick={onStop} data-testid="stop-generation">
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
          停止
        </Button>
      ) : (
        <Button size="sm" variant="primary" onClick={submit} disabled={value.trim().length === 0} data-testid="send-message">
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          发送
        </Button>
      )}
    </div>
  );
}

/** AI 对话页（F7-1/F7-2）：会话列表 + 流式对话 + 引用 */
export function AgentPage(): JSX.Element {
  const { conversationId = null } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const conversationsQuery = useConversations();
  const conversationQuery = useConversation(conversationId);
  const deleteConversation = useDeleteConversation();

  const initialMessages = useMemo<ChatMessageView[]>(
    () =>
      (conversationQuery.data?.messages ?? []).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        citations: message.citations ?? [],
        created_at: message.created_at,
      })),
    [conversationQuery.data],
  );

  const onConversationCreated = useCallback(
    (id: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent.conversations() });
      navigate(`/agent/${id}`, { replace: true });
    },
    [navigate, queryClient],
  );

  const onCompleted = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.agent.all });
  }, [queryClient]);

  const chat = useChatStream({
    conversationId,
    initialMessages,
    onConversationCreated,
    onCompleted,
  });

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [chat.messages]);

  const conversations = conversationsQuery.data ?? [];

  return (
    <div className="flex min-h-[520px] gap-3">
      <aside
        className="flex w-56 shrink-0 flex-col rounded-lg border border-border bg-elevated"
        aria-label="会话列表"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-2">
          <span className="text-xs font-medium text-content">会话</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate('/agent')}
            data-testid="new-conversation"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
            新建
          </Button>
        </div>

        {conversationsQuery.isPending ? (
          <div className="p-2">
            <Skeleton lines={3} />
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2.5 py-3 text-[11px] text-muted">还没有会话，发送第一条消息即可创建。</p>
        ) : (
          <ul className="pkb-scrollbar flex-1 overflow-y-auto p-1.5">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <div
                  className={cn(
                    'group flex items-center gap-1 rounded px-2 py-1.5',
                    conversation.id === conversationId ? 'bg-accent/10' : 'hover:bg-sunken',
                  )}
                >
                  <Link
                    to={`/agent/${conversation.id}`}
                    className="min-w-0 flex-1"
                    aria-current={conversation.id === conversationId ? 'page' : undefined}
                  >
                    <span className="block truncate text-xs text-content">{conversation.title}</span>
                    <span className="block text-[10px] text-muted">
                      {formatRelativeTime(conversation.updated_at)}
                    </span>
                  </Link>
                  <IconButton
                    size="sm"
                    aria-label={`删除会话 ${conversation.title}`}
                    onClick={() => {
                      deleteConversation.mutate(conversation.id, {
                        onSuccess: () => {
                          if (conversation.id === conversationId) {
                            navigate('/agent');
                          }
                        },
                      });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-surface" aria-label="对话">
        {conversationQuery.isError && conversationId ? (
          <div className="p-3">
            <ErrorState
              description={userMessageFor(conversationQuery.error)}
              onRetry={() => void conversationQuery.refetch()}
            />
          </div>
        ) : null}

        <div className="pkb-scrollbar flex-1 overflow-y-auto px-3 py-3">
          {chat.messages.length === 0 ? (
            <EmptyState
              title="开始新的对话"
              description="可以问：帮我整理上周的机器学习笔记 / 向量检索和关键词检索有什么区别。"
              hint="回答会附带本地条目引用，未配置 DeepSeek 时不可用"
              className="border-none bg-transparent py-10"
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {chat.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </ul>
          )}
          <div ref={messagesEndRef} />
        </div>

        {chat.error ? (
          <div className="mx-3 mb-2 rounded border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger" role="alert">
            <div className="flex items-center justify-between gap-2">
              <span>{chat.error}</span>
              <span className="flex gap-2">
                <Button size="sm" onClick={chat.retryLast}>
                  重试
                </Button>
                <Button size="sm" variant="ghost" onClick={chat.clearError}>
                  关闭
                </Button>
              </span>
            </div>
          </div>
        ) : null}

        <div className="px-3 pb-3">
          <ChatComposer streaming={chat.streaming} onSend={chat.send} onStop={chat.stop} />
          <p className="mt-1 text-[11px] text-muted">
            流式输出 · 可随时停止 · 断线自动重连（最多 5 次）
          </p>
        </div>
      </section>
    </div>
  );
}
