// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('@/api/queries/items', () => ({
  useSaveContent: () => ({ mutateAsync: mock.mutateAsync }),
}));

import { API_ERROR_CODES, ApiError } from '@/api/errors';
import { clearDraft, loadDraft } from '@/features/notes/drafts';
import { useAutosave, type UseAutosaveOptions } from '@/features/notes/useAutosave';

function savedItem(version: number, content: string): { id: string; version: number; content: string } {
  return { id: 'item-1', version, content };
}

function renderAutosave(overrides: Partial<UseAutosaveOptions> = {}) {
  return renderHook(() =>
    useAutosave({
      itemId: 'item-1',
      initialContent: '初始正文',
      initialVersion: 1,
      debounceMs: 800,
      ...overrides,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  clearDraft('item-1');
  mock.mutateAsync.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAutosave', () => {
  it('停止输入 800ms 后保存一次，并更新本地版本', async () => {
    mock.mutateAsync.mockResolvedValue(savedItem(2, '新正文'));
    const { result } = renderAutosave();

    act(() => {
      result.current.change('新正文');
    });
    expect(result.current.status).toBe('dirty');
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(loadDraft('item-1')?.content).toBe('新正文');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(mock.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mock.mutateAsync).toHaveBeenCalledWith({
      id: 'item-1',
      content: '新正文',
      expectedVersion: 1,
    });
    expect(result.current.version).toBe(2);
    expect(result.current.status).toBe('saved');
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(loadDraft('item-1')).toBeNull();
  });

  it('保存期间继续输入会串行再保存一次，且带上新版本', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    mock.mutateAsync
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(savedItem(3, '第二版'));

    const { result } = renderAutosave();

    act(() => {
      result.current.change('第一版');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(mock.mutateAsync).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.change('第二版');
    });

    await act(async () => {
      resolveFirst?.(savedItem(2, '第一版'));
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    expect(mock.mutateAsync).toHaveBeenCalledTimes(2);
    expect(mock.mutateAsync).toHaveBeenLastCalledWith({
      id: 'item-1',
      content: '第二版',
      expectedVersion: 2,
    });
    expect(result.current.status).toBe('saved');
  });

  it('409 冲突进入 conflict 态并回调服务端当前对象', async () => {
    const serverItem = { id: 'item-1', version: 7, content: '服务端内容', title: '标题' };
    mock.mutateAsync.mockRejectedValue(
      new ApiError({
        kind: 'conflict',
        code: API_ERROR_CODES.versionConflict,
        message: '版本冲突',
        details: serverItem,
        httpStatus: 409,
      }),
    );

    const onConflict = vi.fn();
    const { result } = renderAutosave({ onConflict });

    act(() => {
      result.current.change('本地改动');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(result.current.status).toBe('conflict');
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(onConflict.mock.calls[0]?.[0]).toEqual(serverItem);
    expect(onConflict.mock.calls[0]?.[1]).toBe('本地改动');
    // 冲突时保留本地草稿，供刷新后恢复
    expect(loadDraft('item-1')?.content).toBe('本地改动');
  });

  it('普通失败进入 error 态并保留内容', async () => {
    mock.mutateAsync.mockRejectedValue(
      new ApiError({ kind: 'server', code: API_ERROR_CODES.unknown, message: '后端异常' }),
    );
    const { result } = renderAutosave();

    act(() => {
      result.current.change('内容');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('后端异常');
    expect(result.current.content).toBe('内容');
  });

  it('reloadFromServer 丢弃本地改动并清除草稿', async () => {
    mock.mutateAsync.mockRejectedValue(
      new ApiError({
        kind: 'conflict',
        code: API_ERROR_CODES.versionConflict,
        message: '冲突',
        details: { id: 'item-1', version: 4 },
      }),
    );
    const { result } = renderAutosave();

    act(() => {
      result.current.change('本地改动');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(result.current.status).toBe('conflict');

    act(() => {
      result.current.reloadFromServer({ content: '服务端内容', version: 4 });
    });

    expect(result.current.content).toBe('服务端内容');
    expect(result.current.version).toBe(4);
    expect(result.current.status).toBe('saved');
    expect(loadDraft('item-1')).toBeNull();
  });

  it('overwriteServer 以服务端版本为基线覆盖写入', async () => {
    mock.mutateAsync.mockResolvedValue(savedItem(9, '本地改动'));
    const { result } = renderAutosave();

    act(() => {
      result.current.change('本地改动');
    });

    await act(async () => {
      await result.current.overwriteServer(8);
    });

    expect(mock.mutateAsync).toHaveBeenCalledWith({
      id: 'item-1',
      content: '本地改动',
      expectedVersion: 8,
    });
    expect(result.current.version).toBe(9);
    expect(result.current.status).toBe('saved');
  });

  it('无改动时立即保存不会发请求', async () => {
    const { result } = renderAutosave();
    await act(async () => {
      await result.current.flush();
    });
    expect(mock.mutateAsync).not.toHaveBeenCalled();
  });
});
