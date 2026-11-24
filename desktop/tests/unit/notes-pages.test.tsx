// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApi, resetApiConfig } from '@/api/config';
import { itemsApi } from '@/api/queries/items';
import { listMockItems, resetItemMocks, itemRoutes } from '../fixtures/items-mock';
import { createMockFetch, MOCK_BASE_URL } from '@/mocks/router';
import { NotesListPage } from '@/features/notes/NotesListPage';
import { NewNotePage } from '@/features/notes/NewNotePage';
import { NoteEditorPage } from '@/features/notes/NoteEditorPage';

// CodeMirror 在 jsdom 中缺少布局 API，用 textarea 替身验证业务逻辑
vi.mock('@/features/notes/CodeMirrorEditor', () => ({
  CodeMirrorEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="正文编辑器"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

function createClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderAt(initialPath: string, element: JSX.Element): void {
  render(
    <QueryClientProvider client={createClient()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/notes" element={<NotesListPage />} />
          <Route path="/notes/new" element={<NewNotePage />} />
          <Route path="/notes/:itemId" element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetApiConfig();
  resetItemMocks();
  configureApi({
    baseUrl: MOCK_BASE_URL,
    token: 'mock-token',
    fetchImpl: createMockFetch({ routes: itemRoutes, latencyMs: 0 }),
    sleep: async () => undefined,
    random: () => 0.5,
  });
});

afterEach(() => {
  window.localStorage.clear();
});

describe('NotesListPage', () => {
  it('展示种子条目与新建入口', async () => {
    renderAt('/notes', <div />);
    expect(await screen.findByText('向量检索笔记')).toBeInTheDocument();
    expect(screen.getByText('贝叶斯公式')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /新建笔记/ })).toHaveAttribute(
      'href',
      '/notes/new?type=note',
    );
    expect(screen.getByText('3 条')).toBeInTheDocument();
  });
});

describe('NewNotePage', () => {
  it('标题为空时给出校验提示且不创建', async () => {
    const user = userEvent.setup();
    renderAt('/notes/new', <div />);

    await user.click(screen.getByTestId('create-submit'));
    expect(await screen.findByText('标题长度需为 1–200 字符')).toBeInTheDocument();
    expect(listMockItems()).toHaveLength(3);
  });

  it('填写完整后创建并跳转编辑器路由', async () => {
    const user = userEvent.setup();
    renderAt('/notes/new', <NoteEditorPage />);

    await user.type(screen.getByLabelText(/标题/), '新笔记标题');
    await user.type(screen.getByLabelText('正文编辑器'), '这是正文');
    await user.click(screen.getByTestId('create-submit'));

    await waitFor(() => {
      expect(screen.getByLabelText('标题')).toHaveValue('新笔记标题');
    });
    expect(listMockItems()).toHaveLength(4);
  });
});

describe('NoteEditorPage 版本冲突', () => {
  async function setupConflict(): Promise<{ id: string; editor: HTMLElement }> {
    const target = listMockItems()[0];
    if (!target) {
      throw new Error('mock 数据缺失');
    }
    renderAt(`/notes/${target.id}`, <NoteEditorPage />);

    const user = userEvent.setup();
    const editor = await screen.findByLabelText('正文编辑器');
    expect(editor).toHaveValue(target.content ?? '');

    // 模拟「另一个窗口」先写入，使服务端版本领先本地
    await act(async () => {
      await itemsApi.saveContent(target.id, '服务端已更新', target.version);
    });

    await user.type(editor, '本地改动');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument(), { timeout: 6_000 });
    return { id: target.id, editor };
  }

  it('冲突后可选「使用服务端版本」并刷新编辑器', async () => {
    const { id } = await setupConflict();
    const user = userEvent.setup();

    expect(screen.getByRole('dialog', { name: '版本冲突' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '使用服务端版本' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByLabelText('正文编辑器')).toHaveValue('服务端已更新'));

    const server = await itemsApi.content(id);
    expect(server).toBe('服务端已更新');
  });

  it('冲突后可选「保留本地并覆盖」写入服务端', async () => {
    const { id } = await setupConflict();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '保留本地并覆盖' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await waitFor(async () => {
      const server = await itemsApi.content(id);
      expect(server).toContain('本地改动');
    });
  });
});
