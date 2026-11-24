/**
 * AI 对话 Mock（F7 前置，契约 9.6）。B7 尚未产出 `/agent/*`，按 13.6 提供同形替身：
 * - `GET /agent/conversations`、`GET/DELETE /agent/conversations/{id}`
 * - `POST /agent/chat`：SSE 流（message.started → message.delta × N → message.completed）
 *
 * B7 合入后删除本文件与 `src/mocks/index.ts` 中的路由，重跑 `gen:api` 切真实契约。
 */
import { API_ERROR_CODES } from '@/api/errors';
import { fail, ok } from './envelope';
import type { MockRequest, MockResponse, MockRoute } from './router';

interface MockMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  citations: Array<{ item_id: string; title: string; snippet: string; score: number }>;
  tool_calls: Array<{ name: string; arguments: Record<string, unknown>; result_summary: string }>;
  created_at: string;
}

interface MockConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: MockMessage[];
}

const conversations = new Map<string, MockConversation>();
let seeded = false;
let chunkDelayMs = 5;
let chunkSize = 12;

const CITATION = {
  item_id: '0199d000-0000-7000-8000-000000000001',
  title: '向量检索笔记',
  snippet: '通过嵌入模型把文本映射到向量空间，再做近邻检索。',
  score: 0.87,
};

function nowIso(): string {
  return new Date().toISOString();
}

function seed(): void {
  if (seeded) {
    return;
  }
  seeded = true;
  const id = '0199e000-0000-7000-8000-000000000001';
  conversations.set(id, {
    id,
    title: '向量检索是什么',
    created_at: '2026-11-24T06:00:00Z',
    updated_at: '2026-11-24T06:02:00Z',
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: '向量检索是什么？',
        citations: [],
        tool_calls: [],
        created_at: '2026-11-24T06:00:00Z',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: '**向量检索**把文本映射到向量空间，用近邻距离衡量语义相似度。',
        citations: [CITATION],
        tool_calls: [],
        created_at: '2026-11-24T06:02:00Z',
      },
    ],
  });
}

export interface AgentMockOptions {
  /** 每段 delta 的间隔（毫秒），测试「停止生成」时可调大 */
  chunkDelayMs?: number;
  /** 每段 delta 的字符数 */
  chunkSize?: number;
}

export function resetAgentMocks(options: AgentMockOptions = {}): void {
  conversations.clear();
  seeded = false;
  chunkDelayMs = options.chunkDelayMs ?? 5;
  chunkSize = options.chunkSize ?? 12;
  seed();
}

export function listMockConversations(): MockConversation[] {
  seed();
  return [...conversations.values()].map((conversation) => ({
    ...conversation,
    messages: conversation.messages.map((message) => ({ ...message })),
  }));
}

function listConversations(): MockResponse {
  seed();
  const items = [...conversations.values()]
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
    .map(({ id, title, created_at, updated_at }) => ({ id, title, created_at, updated_at }));
  return ok(items);
}

function findConversation(id: string): MockConversation | undefined {
  seed();
  return conversations.get(id);
}

function detail(id: string): MockResponse {
  const conversation = findConversation(id);
  if (!conversation) {
    return fail(API_ERROR_CODES.notFound, '会话不存在', 404);
  }
  return ok({
    id: conversation.id,
    title: conversation.title,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    messages: conversation.messages,
  });
}

function remove(id: string): MockResponse {
  const conversation = findConversation(id);
  if (!conversation) {
    return fail(API_ERROR_CODES.notFound, '会话不存在', 404);
  }
  conversations.delete(id);
  return ok({ id });
}

function buildAnswer(question: string): string {
  const trimmed = question.trim();
  return (
    `关于「${trimmed}」，我在你的知识库里找到了相关条目。\n\n` +
    '- **向量检索**：把文本映射到向量空间后做近邻查询。\n' +
    '- 混合检索用 RRF 融合关键词与语义结果，兼顾精确与召回。\n\n' +
    '> 以上内容来自本地笔记，仅供参考。'
  );
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function chatStream(request: MockRequest): MockResponse {
  let body: { conversation_id?: string | null; messages?: Array<{ role: string; content: string }> };
  try {
    body = JSON.parse(request.text || '{}') as typeof body;
  } catch {
    return fail(API_ERROR_CODES.validation, '请求体不是合法 JSON', 422);
  }

  const messages = body.messages ?? [];
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  if (!lastUser || lastUser.content.trim().length === 0) {
    return fail(API_ERROR_CODES.validation, 'messages 至少包含一条非空 user 消息', 422);
  }

  seed();
  let conversation = body.conversation_id ? conversations.get(body.conversation_id) : undefined;
  if (body.conversation_id && !conversation) {
    return fail(API_ERROR_CODES.notFound, '会话不存在', 404);
  }
  if (!conversation) {
    const id = crypto.randomUUID();
    conversation = {
      id,
      title: lastUser.content.trim().slice(0, 20),
      created_at: nowIso(),
      updated_at: nowIso(),
      messages: [],
    };
    conversations.set(id, conversation);
  }

  const conversationId = conversation.id;
  const userMessage: MockMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: lastUser.content,
    citations: [],
    tool_calls: [],
    created_at: nowIso(),
  };
  conversation.messages.push(userMessage);
  conversation.updated_at = nowIso();

  const assistantId = crypto.randomUUID();
  const answer = buildAnswer(lastUser.content);
  const chunks: string[] = [];
  for (let index = 0; index < answer.length; index += chunkSize) {
    chunks.push(answer.slice(index, index + chunkSize));
  }

  const encoder = new TextEncoder();
  let index = 0;
  let finished = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const abort = (): void => {
        if (finished) {
          return;
        }
        finished = true;
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      };
      request.signal?.addEventListener('abort', abort);

      const push = (): void => {
        if (finished) {
          return;
        }
        if (index === 0) {
          controller.enqueue(
            encoder.encode(sseFrame('message.started', { conversation_id: conversationId, message_id: assistantId })),
          );
        }
        if (index < chunks.length) {
          const delta = chunks[index] ?? '';
          index += 1;
          controller.enqueue(encoder.encode(sseFrame('message.delta', { message_id: assistantId, delta })));
          setTimeout(push, chunkDelayMs);
          return;
        }

        finished = true;
        controller.enqueue(
          encoder.encode(
            sseFrame('message.completed', {
              message_id: assistantId,
              finish_reason: 'stop',
              citations: [CITATION],
              usage: { input_tokens: 42, output_tokens: 88 },
            }),
          ),
        );
        const conversationRecord = conversations.get(conversationId);
        conversationRecord?.messages.push({
          id: assistantId,
          role: 'assistant',
          content: answer,
          citations: [CITATION],
          tool_calls: [],
          created_at: nowIso(),
        });
        if (conversationRecord) {
          conversationRecord.updated_at = nowIso();
        }
        controller.close();
      };

      push();
    },
  });

  return {
    response: new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    }),
  };
}

/** F7 mock 路由；B7 合入后逐条删除 */
export const agentMockRoutes: MockRoute[] = [
  {
    id: 'F7/conversations-list',
    method: 'GET',
    pattern: /^\/agent\/conversations$/,
    handler: () => listConversations(),
  },
  {
    id: 'F7/conversation-detail',
    method: 'GET',
    pattern: /^\/agent\/conversations\/([^/]+)$/,
    handler: (_request, params) => detail(params[0] ?? ''),
  },
  {
    id: 'F7/conversation-delete',
    method: 'DELETE',
    pattern: /^\/agent\/conversations\/([^/]+)$/,
    handler: (_request, params) => remove(params[0] ?? ''),
  },
  {
    id: 'F7/chat-stream',
    method: 'POST',
    pattern: /^\/agent\/chat$/,
    handler: (request) => chatStream(request),
  },
];
