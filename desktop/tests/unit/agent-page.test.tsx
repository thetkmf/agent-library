// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { configureApi, resetApiConfig } from '@/api/config';
import { createMockFetch, MOCK_BASE_URL } from '@/mocks/router';
import { agentMockRoutes, listMockConversations, resetAgentMocks } from '../fixtures/agent-mock';
import { AgentPage } from '@/features/agent/AgentPage';

function createClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderAgent(path = '/agent'): void {
  render(
    <QueryClientProvider client={createClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/agent/:conversationId" element={<AgentPage />} />
          <Route path="/notes/:itemId" element={<div>编辑器占位</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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

describe('AgentPage', () => {
  it('展示会话列表并可打开历史会话', async () => {
    const user = userEvent.setup();
    renderAgent();

    const conversation = await screen.findByRole('link', { name: /向量检索是什么/ });
    await user.click(conversation);

    await waitFor(() => expect(screen.getByText('向量检索是什么？')).toBeInTheDocument());
    // 助手消息经 Markdown 渲染（加粗）
    const assistant = screen.getByTestId('message-assistant');
    expect(assistant.querySelector('strong')).not.toBeNull();
    // 引用来源可点击跳转
    expect(within(assistant).getByRole('link', { name: /向量检索笔记/ })).toHaveAttribute(
      'href',
      '/notes/0199d000-0000-7000-8000-000000000001',
    );
  });

  it('新会话发送消息后流式输出并完成', async () => {
    const user = userEvent.setup();
    renderAgent();

    await screen.findByText('开始新的对话');
    await user.type(screen.getByLabelText('输入消息'), '帮我整理检索笔记');
    await user.click(screen.getByTestId('send-message'));

    await waitFor(() => expect(screen.getByText('生成中…')).toBeInTheDocument());
    await waitFor(
      () => expect(screen.queryByText('生成中…')).toBeNull(),
      { timeout: 8_000 },
    );

    const assistantMessages = screen.getAllByTestId('message-assistant');
    expect(assistantMessages.length).toBeGreaterThan(0);
    expect(assistantMessages.at(-1)).toHaveTextContent('向量检索');
    // 流式完成后会话出现在列表
    await waitFor(() => expect(listMockConversations().length).toBeGreaterThanOrEqual(2));
  });

  it('生成过程中可以停止', async () => {
    // 放慢流式输出，确保点击「停止」时仍在生成
    resetAgentMocks({ chunkDelayMs: 150, chunkSize: 4 });
    const user = userEvent.setup();
    renderAgent();

    await screen.findByText('开始新的对话');
    await user.type(screen.getByLabelText('输入消息'), '写一段较长的解释');
    await user.click(screen.getByTestId('send-message'));

    const stopButton = await screen.findByTestId('stop-generation');
    await user.click(stopButton);

    await waitFor(() => expect(screen.getByText('已停止生成')).toBeInTheDocument());
    expect(screen.getByTestId('send-message')).toBeInTheDocument();
  });

  it('删除会话后从列表移除', async () => {
    const user = userEvent.setup();
    renderAgent();

    const deleteButton = await screen.findByRole('button', { name: /删除会话 向量检索是什么/ });
    await user.click(deleteButton);

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /向量检索是什么/ })).toBeNull(),
    );
    expect(listMockConversations().some((conversation) => conversation.title === '向量检索是什么')).toBe(
      false,
    );
  });
});
