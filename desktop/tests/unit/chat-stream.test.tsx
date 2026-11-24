// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { configureApi, resetApiConfig } from '@/api/config';
import { createMockFetch, MOCK_BASE_URL } from '@/mocks/router';
import { agentMockRoutes, resetAgentMocks } from '../fixtures/agent-mock';
import { useChatStream } from '@/features/agent/useChatStream';

beforeEach(() => {
  resetApiConfig();
  resetAgentMocks();
  configureApi({
    baseUrl: MOCK_BASE_URL,
    token: 'mock-token',
    fetchImpl: createMockFetch({ routes: agentMockRoutes, latencyMs: 0 }),
    sleep: async () => undefined,
    random: () => 0.5,
  });
});

describe('useChatStream', () => {
  it('发送消息后逐段接收并完成，带引用', async () => {
    const created: string[] = [];
    const { result } = renderHook(() =>
      useChatStream({
        conversationId: null,
        initialMessages: [],
        onConversationCreated: (id) => created.push(id),
      }),
    );

    act(() => {
      result.current.send('向量检索是什么');
    });

    expect(result.current.streaming).toBe(true);
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]?.content).toBe('向量检索是什么');

    await waitFor(() => expect(result.current.streaming).toBe(false), { timeout: 5_000 });

    const assistant = result.current.messages[1];
    expect(assistant?.role).toBe('assistant');
    expect(assistant?.pending).toBe(false);
    expect(assistant?.content).toContain('向量检索');
    expect(assistant?.citations.length).toBeGreaterThan(0);
    expect(created).toHaveLength(1);
  });

  it('用户停止后保留已生成内容并标记 stopped', async () => {
    const { result } = renderHook(() =>
      useChatStream({ conversationId: null, initialMessages: [] }),
    );

    act(() => {
      result.current.send('帮我总结一下');
    });

    await waitFor(() => expect(result.current.messages[1]?.content.length ?? 0).toBeGreaterThan(0), {
      timeout: 5_000,
    });

    act(() => {
      result.current.stop();
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.messages[1]?.stopped).toBe(true);
    expect(result.current.messages[1]?.pending).toBe(false);
  });

  it('发送空消息不产生请求', () => {
    const { result } = renderHook(() =>
      useChatStream({ conversationId: null, initialMessages: [] }),
    );
    act(() => {
      result.current.send('   ');
    });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.streaming).toBe(false);
  });

  it('会话不存在时报错并可重试', async () => {
    const { result } = renderHook(() =>
      useChatStream({ conversationId: 'not-exist', initialMessages: [] }),
    );

    act(() => {
      result.current.send('你好');
    });

    await waitFor(() => expect(result.current.error).toBeTruthy(), { timeout: 5_000 });
    expect(result.current.streaming).toBe(false);

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });
});
