// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { configureApi, resetApiConfig } from '@/api/config';
import { createMockFetch, MOCK_BASE_URL } from '@/mocks/router';
import { resetSearchMocks, searchMockRoutes } from '@/mocks/search';
import { SearchPage } from '@/features/search/SearchPage';

function createClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderSearch(path = '/search'): void {
  render(
    <QueryClientProvider client={createClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/search" element={<SearchPage />} />
          <Route path="/notes/:itemId" element={<div>编辑器占位</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetApiConfig();
  resetSearchMocks({ embeddingStatus: 'ready' });
  configureApi({
    baseUrl: MOCK_BASE_URL,
    token: 'mock-token',
    fetchImpl: createMockFetch({ routes: searchMockRoutes, latencyMs: 0 }),
    sleep: async () => undefined,
    random: () => 0.5,
  });
});

describe('SearchPage', () => {
  it('索引状态卡展示计数与嵌入模型', async () => {
    renderSearch();
    const card = await screen.findByTestId('index-status-card');
    await waitFor(() => expect(card).toHaveTextContent('语义检索可用'));
    expect(card).toHaveTextContent('已索引 6');
    expect(card).toHaveTextContent('bge-small-zh-v1.5（512 维）');
  });

  it('URL 中的关键字直接发起检索并高亮命中片段', async () => {
    renderSearch('/search?q=%E5%90%91%E9%87%8F');

    expect(await screen.findByTestId('search-summary')).toHaveTextContent('命中');
    const snippet = screen.getAllByTestId('search-snippet')[0];
    expect(snippet).toBeDefined();
    expect(within(snippet as HTMLElement).getAllByText('向量').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '向量检索笔记' })).toHaveAttribute(
      'href',
      '/notes/0199d000-0000-7000-8000-000000000001',
    );
  });

  it('输入关键字点击检索后展示结果', async () => {
    const user = userEvent.setup();
    renderSearch();
    await screen.findByTestId('index-status-card');

    await user.type(screen.getByLabelText('检索关键字'), '分片');
    await user.click(screen.getByRole('button', { name: '检索' }));

    await waitFor(() => expect(screen.getByText('文件存储设计')).toBeInTheDocument());
  });

  it('切换到语义模式后展示语义命中标签', async () => {
    const user = userEvent.setup();
    renderSearch('/search?q=%E6%95%B0%E6%8D%AE%E5%BA%93');

    await waitFor(() => expect(screen.getByTestId('search-summary')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '语义' }));

    await waitFor(() => {
      const badges = screen.queryAllByText('语义命中');
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  it('嵌入不可用时展示降级提示并以关键词模式返回', async () => {
    resetSearchMocks({ embeddingStatus: 'missing' });
    renderSearch('/search?q=%E5%90%91%E9%87%8F&mode=semantic');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('已自动降级为关键词检索'),
    );
    expect(screen.getByTestId('search-summary')).toHaveTextContent('模式 关键词');
    // 嵌入缺失时索引卡提示不可用
    expect(screen.getByTestId('index-status-card')).toHaveTextContent('语义检索不可用');
  });

  it('非法模式进入错误态且不发请求', async () => {
    renderSearch('/search?q=%E5%90%91%E9%87%8F&mode=fuzzy');

    expect(await screen.findByText('检索条件不合法')).toBeInTheDocument();
    expect(screen.getByText(/不支持的检索模式/)).toBeInTheDocument();
    expect(screen.queryByTestId('search-summary')).toBeNull();
  });

  it('关键字超长时提示且不发起检索', async () => {
    renderSearch(`/search?q=${'a'.repeat(201)}`);
    expect(await screen.findByText('检索条件不合法')).toBeInTheDocument();
    expect(screen.queryByTestId('search-summary')).toBeNull();
  });

  it('无结果时展示引导文案', async () => {
    renderSearch('/search?q=zzzzzz');
    expect(await screen.findByText('没有匹配结果')).toBeInTheDocument();
  });

  it('触发全量重建后提示已提交任务', async () => {
    const user = userEvent.setup();
    renderSearch();
    await screen.findByTestId('index-status-card');

    await user.click(screen.getByRole('button', { name: '全量重建' }));

    await waitFor(() =>
      expect(screen.getByText(/已提交重建任务/)).toBeInTheDocument(),
    );
    // 状态刷新后出现任务进度
    await waitFor(() => expect(screen.getByTestId('index-status-card')).toHaveTextContent('排队中'));
  });
});
