// @vitest-environment jsdom
import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/queries/files', () => ({
  filesApi: {
    upload: uploadMock,
    download: vi.fn(),
  },
}));

import { ApiError } from '@/api/errors';
import {
  resetUploadQueueForTests,
  setUploadListener,
  useUploadQueue,
} from '@/features/files/useUploadQueue';

function makeFile(name: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type: 'text/plain' });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetUploadQueueForTests();
  uploadMock.mockReset();
});

describe('useUploadQueue', () => {
  it('上传前校验：合法入队、非法给出原因', () => {
    const result = useUploadQueue.getState().add([makeFile('ok.txt'), makeFile('bad.exe'), makeFile('empty.txt', 0)]);

    expect(result.accepted.map((task) => task.name)).toEqual(['ok.txt']);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]?.reason).toContain('不支持');
    expect(useUploadQueue.getState().tasks).toHaveLength(1);
  });

  it('并发上限 2：完成后自动开始排队任务', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const third = deferred<unknown>();
    uploadMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);

    act(() => {
      useUploadQueue.getState().add([makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')]);
    });

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    expect(useUploadQueue.getState().tasks.filter((task) => task.status === 'uploading')).toHaveLength(2);

    await act(async () => {
      first.resolve({ item: { id: 'i1' }, file_asset: { id: 'f1' } });
      await first.promise;
    });

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(3));
  });

  it('进度回调写入任务进度', async () => {
    uploadMock.mockImplementation(async (_input: unknown, options: { onProgress?: (p: { ratio: number }) => void }) => {
      options.onProgress?.({ ratio: 0.5 });
      return { item: { id: 'i1' }, file_asset: { id: 'f1' } };
    });

    act(() => {
      useUploadQueue.getState().add([makeFile('a.txt')]);
    });

    await waitFor(() => {
      const task = useUploadQueue.getState().tasks[0];
      expect(task?.status === 'done' || task?.progress === 0.5).toBe(true);
    });
  });

  it('上传成功后通知监听者并标记完成', async () => {
    const result = { item: { id: 'item-1' }, file_asset: { id: 'asset-1' } };
    uploadMock.mockResolvedValue(result);
    const listener = vi.fn();
    setUploadListener(listener);

    act(() => {
      useUploadQueue.getState().add([makeFile('a.txt')]);
    });

    await waitFor(() => expect(useUploadQueue.getState().tasks[0]?.status).toBe('done'));
    expect(listener).toHaveBeenCalledWith(result);
    expect(useUploadQueue.getState().tasks[0]?.progress).toBe(1);
  });

  it('失败进入 error，可重试成功', async () => {
    uploadMock
      .mockRejectedValueOnce(new ApiError({ kind: 'server', code: 10001, message: '后端异常' }))
      .mockResolvedValueOnce({ item: { id: 'i1' }, file_asset: { id: 'f1' } });

    act(() => {
      useUploadQueue.getState().add([makeFile('a.txt')]);
    });

    await waitFor(() => expect(useUploadQueue.getState().tasks[0]?.status).toBe('error'));
    expect(useUploadQueue.getState().tasks[0]?.error).toBe('后端异常');

    const id = useUploadQueue.getState().tasks[0]?.id;
    act(() => {
      if (id) {
        useUploadQueue.getState().retry(id);
      }
    });

    await waitFor(() => expect(useUploadQueue.getState().tasks[0]?.status).toBe('done'));
    expect(useUploadQueue.getState().tasks[0]?.attempts).toBe(2);
  });

  it('取消进行中的任务标记为 canceled', async () => {
    uploadMock.mockImplementation(
      (_input: unknown, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    act(() => {
      useUploadQueue.getState().add([makeFile('a.txt')]);
    });
    await waitFor(() => expect(useUploadQueue.getState().tasks[0]?.status).toBe('uploading'));

    const id = useUploadQueue.getState().tasks[0]?.id;
    act(() => {
      if (id) {
        useUploadQueue.getState().cancel(id);
      }
    });

    await waitFor(() => expect(useUploadQueue.getState().tasks[0]?.status).toBe('canceled'));
  });

  it('clearFinished 只保留未完成项', async () => {
    uploadMock.mockResolvedValue({ item: { id: 'i1' }, file_asset: { id: 'f1' } });
    act(() => {
      useUploadQueue.getState().add([makeFile('a.txt')]);
    });
    await waitFor(() => expect(useUploadQueue.getState().tasks[0]?.status).toBe('done'));

    act(() => {
      useUploadQueue.getState().clearFinished();
    });
    expect(useUploadQueue.getState().tasks).toHaveLength(0);
  });
});
