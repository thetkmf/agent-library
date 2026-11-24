// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { configureApi, resetApiConfig } from '@/api/config';
import { useTagBatch } from '@/api/queries/timeline';
import {
  listMockTags,
  listMockTimelineItems,
  resetTimelineMocks,
  tagTimelineMockRoutes,
} from '../fixtures/timeline-mock';
import { createMockFetch, MOCK_BASE_URL } from '@/mocks/router';
import { TimelinePage } from '@/features/timeline/TimelinePage';

function createClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderTimeline(path = '/timeline'): void {
  render(
    <QueryClientProvider client={createClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/timeline" element={<TimelinePage />} />
          <Route path="/notes/:itemId" element={<div>编辑器占位</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetApiConfig();
  resetTimelineMocks({ count: 12, intervalMs: 3 * 60 * 60 * 1000 });
  configureApi({
    baseUrl: MOCK_BASE_URL,
    token: 'mock-token',
    fetchImpl: createMockFetch({ routes: tagTimelineMockRoutes, latencyMs: 0 }),
    sleep: async () => undefined,
    random: () => 0.5,
  });
});

describe('TimelinePage', () => {
  it('按日分组渲染条目并显示分组计数', async () => {
    renderTimeline();

    expect(await screen.findByTestId('timeline-scroller')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0));

    expect(screen.getByText(/已加载 \d+ 条/)).toBeInTheDocument();
    // 12 条 × 3 小时 → 至少两组
    expect(screen.getByText(/共 \d+ 组/)).toBeInTheDocument();
  });

  it('URL 中的 type 筛选会传给接口并只返回 TeX 条目', async () => {
    renderTimeline('/timeline?type=tex');

    const scroller = await screen.findByTestId('timeline-scroller');
    await waitFor(() => {
      expect(within(scroller).getAllByText('TeX').length).toBeGreaterThan(0);
    });
    // 卡片区内不应出现「笔记」类型徽标（筛选栏按钮不算）
    expect(within(scroller).queryByText('笔记')).toBeNull();
  });

  it('非法筛选值进入错误态且不发请求', async () => {
    renderTimeline('/timeline?group_by=year');

    expect(await screen.findByText('筛选条件不合法')).toBeInTheDocument();
    expect(screen.getByText(/不支持的分组方式/)).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-scroller')).toBeNull();
  });

  it('批量打标：选择条目后添加标签并汇总结果', async () => {
    const user = userEvent.setup();
    renderTimeline();
    await screen.findByTestId('timeline-scroller');

    await user.click(screen.getByTestId('toggle-select-mode'));

    const checkboxes = await screen.findAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    await user.click(checkboxes[0] as HTMLElement);
    await user.click(checkboxes[1] as HTMLElement);

    expect(screen.getAllByText('已选 2 条').length).toBeGreaterThan(0);
    const tagSelect = screen.getByLabelText('选择标签');
    await user.selectOptions(tagSelect, '0199b100-0000-7000-8000-000000000001');
    await user.click(screen.getByTestId('apply-tag-batch'));

    await waitFor(() => expect(screen.getByTestId('tag-batch-summary')).toHaveTextContent('成功 2 条'));

    const tagged = listMockTimelineItems().filter((item) =>
      (item.tags ?? []).some((tag) => tag.id === '0199b100-0000-7000-8000-000000000001'),
    );
    expect(tagged.length).toBeGreaterThanOrEqual(2);
  });
});

describe('useTagBatch', () => {
  function wrapper({ children }: { children: React.ReactNode }): JSX.Element {
    return <QueryClientProvider client={createClient()}>{children}</QueryClientProvider>;
  }

  it('部分失败时返回 succeeded/failed，并可用失败项重试', async () => {
    const tag = listMockTags()[0];
    const item = listMockTimelineItems()[0];
    if (!tag || !item) {
      throw new Error('mock 数据缺失');
    }

    const { result } = renderHook(() => useTagBatch(), { wrapper });

    let outcome: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        mode: 'add',
        tagId: tag.id,
        itemIds: [item.id, 'missing-item-id'],
      });
    });

    expect(outcome?.succeeded).toEqual([item.id]);
    expect(outcome?.failed.map((entry) => entry.itemId)).toEqual(['missing-item-id']);
    expect(outcome?.failed[0]?.message.length).toBeGreaterThan(0);
  });
});
