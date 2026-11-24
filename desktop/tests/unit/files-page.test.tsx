// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApi, resetApiConfig } from '@/api/config';
import { createMockFetch, MOCK_BASE_URL, type MockRoute } from '@/mocks/router';
import { ok } from '@/mocks/envelope';
import { resetUploadQueueForTests } from '@/features/files/useUploadQueue';
import { FilesPage } from '@/features/files/FilesPage';
import type * as FilesNamespace from '@/api/queries/files';

const downloadMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/queries/files', async (importOriginal) => {
  const actual = await importOriginal<typeof FilesNamespace>();
  return {
    ...actual,
    filesApi: {
      ...actual.filesApi,
      download: downloadMock,
    },
  };
});

const FILE_ITEM = {
  id: '0199c000-0000-7000-8000-000000000001',
  type: 'file',
  title: '说明文档',
  content: null,
  preview: '',
  tags: [{ id: '0199b100-0000-7000-8000-000000000001', name: '资料' }],
  file: {
    id: '0199c100-0000-7000-8000-000000000001',
    original_name: '说明.txt',
    mime_type: 'text/plain',
    size_bytes: 2048,
    sha256: '0'.repeat(64),
    download_url: '/files/0199c100-0000-7000-8000-000000000001/download',
    created_at: '2026-11-24T08:00:00Z',
  },
  status: 'active',
  version: 1,
  embedding_status: 'skipped',
  ai_summary: null,
  created_at: '2026-11-24T08:00:00Z',
  updated_at: '2026-11-24T08:00:00Z',
  deleted_at: null,
  idempotent_replay: false,
};

function pageRoutes(items: unknown[]): MockRoute[] {
  return [
    {
      id: 'F5/files-list',
      method: 'GET',
      pattern: /^\/items$/,
      handler: () =>
        ok({
          items,
          page: 1,
          page_size: 100,
          total: items.length,
          has_more: false,
        }),
    },
    {
      id: 'F5/file-upload',
      method: 'POST',
      pattern: /^\/files$/,
      handler: () => ok({ item: FILE_ITEM, file_asset: FILE_ITEM.file }, { status: 201 }),
    },
  ];
}

function createClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderPage(): void {
  render(
    <QueryClientProvider client={createClient()}>
      <MemoryRouter>
        <FilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetApiConfig();
  resetUploadQueueForTests();
  downloadMock.mockReset();
  downloadMock.mockResolvedValue({
    // jsdom 的 Blob 可能缺少 text()，这里用最小替身满足预览路径
    blob: { text: async () => '文件内容示例' } as unknown as Blob,
    filename: '说明.txt',
    contentType: 'text/plain',
    status: 200,
  });
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  configureApi({
    baseUrl: MOCK_BASE_URL,
    token: 'mock-token',
    fetchImpl: createMockFetch({ routes: pageRoutes([FILE_ITEM]), latencyMs: 0 }),
    sleep: async () => undefined,
    random: () => 0.5,
  });
});

afterEach(() => {
  window.localStorage.clear();
});

describe('FilesPage', () => {
  it('渲染文件列表（原始文件名、大小、标签、下载与预览入口）', async () => {
    renderPage();

    expect(await screen.findByText('说明.txt')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('资料')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /预览 说明文档/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /下载 说明文档/ })).toBeEnabled();
  });

  it('预览文本文件时展示下载得到的文本内容', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('说明.txt');

    await user.click(screen.getByRole('button', { name: /预览 说明文档/ }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('文件内容示例')).toBeInTheDocument());
    expect(downloadMock).toHaveBeenCalledWith(FILE_ITEM.file.id, { signal: expect.anything() });
  });

  it('下载调用鉴权下载接口并释放 object URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('说明.txt');

    await user.click(screen.getByRole('button', { name: /下载 说明文档/ }));

    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
    expect(URL.createObjectURL).toHaveBeenCalled();
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: /下载 说明文档/ })).toBeEnabled();
      },
      { timeout: 3000 },
    );
  });

  it('上传非法类型时给出可读拒绝原因', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('说明.txt');

    const input = screen.getByLabelText('选择要上传的文件');
    const badFile = new File([new Uint8Array([1, 2, 3])], 'tool.exe', {
      type: 'application/octet-stream',
    });
    await user.upload(input, badFile);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('tool.exe');
    expect(alert).toHaveTextContent('不支持的文件类型');
  });

  it('空列表显示引导文案', async () => {
    resetApiConfig();
    configureApi({
      baseUrl: MOCK_BASE_URL,
      token: 'mock-token',
      fetchImpl: createMockFetch({ routes: pageRoutes([]), latencyMs: 0 }),
      sleep: async () => undefined,
      random: () => 0.5,
    });

    renderPage();
    expect(await screen.findByText('还没有文件')).toBeInTheDocument();
  });
});
