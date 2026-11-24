import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import {
  sha256Hex,
  uploadLargeFile,
  type ChunkedUploadDeps,
  type ChunkedUploadState,
} from '@/features/files/chunked-upload';
import { planUpload } from '@/features/files/file-validation';

const CHUNK = 4;

function makeFile(size = 10, name = 'big.bin'): File {
  return new File([new Uint8Array(size).fill(7)], name, { type: 'application/octet-stream' });
}

function makeDeps(overrides: Partial<ChunkedUploadDeps> = {}) {
  const putCalls: Array<{ index: number; size: number }> = [];
  const deps: ChunkedUploadDeps = {
    sha256: async () => 'f'.repeat(64),
    init: async () => ({ upload_id: 'up-1', chunk_size: CHUNK, chunk_count: 3 }),
    putChunk: async (_uploadId, index, chunk) => {
      putCalls.push({ index, size: chunk.size });
      return { index, sha256: 'a'.repeat(64) };
    },
    complete: async () => ({
      item: { id: 'item-1' } as never,
      file_asset: { id: 'asset-1' } as never,
    }),
    concurrency: 3,
    ...overrides,
  };
  return { deps, putCalls };
}

describe('planUpload', () => {
  it('超过 50 MB 走分片', () => {
    expect(planUpload(50 * 1024 * 1024)).toBe('single');
    expect(planUpload(50 * 1024 * 1024 + 1)).toBe('chunked');
  });
});

describe('sha256Hex', () => {
  it('计算标准 SHA-256（已知向量）', async () => {
    const blob = new Blob(['abc']);
    expect(await sha256Hex(blob)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('uploadLargeFile', () => {
  it('按 init 分片上传并 complete，进度逐步推进', async () => {
    const { deps, putCalls } = makeDeps();
    const progress: number[] = [];
    const result = await uploadLargeFile(makeFile(10), { deps, onProgress: (r) => progress.push(r) });

    expect(result.file_asset).toMatchObject({ id: 'asset-1' });
    expect(putCalls.map((call) => call.index).sort()).toEqual([0, 1, 2]);
    expect(putCalls.find((call) => call.index === 2)?.size).toBe(2); // 最后一片
    expect(progress.at(-1)).toBe(1);
  });

  it('并发不超过约定值', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { deps } = makeDeps({
      concurrency: 2,
      init: async () => ({ upload_id: 'up-1', chunk_size: 1, chunk_count: 6 }),
      putChunk: async (_id, index) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { index, sha256: 'a' };
      },
    });

    await uploadLargeFile(makeFile(6), { deps });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('分片失败按 index 重试后成功', async () => {
    const attempts = new Map<number, number>();
    const retried: number[] = [];
    const { deps } = makeDeps({
      putChunk: async (_id, index) => {
        const count = (attempts.get(index) ?? 0) + 1;
        attempts.set(index, count);
        if (index === 1 && count === 1) {
          throw new ApiError({ kind: 'server', code: 10001, message: '瞬时失败' });
        }
        return { index, sha256: 'a' };
      },
    });

    const result = await uploadLargeFile(makeFile(10), {
      deps,
      maxChunkRetries: 2,
      onChunkRetry: (index) => retried.push(index),
    });

    expect(result.item.id).toBe('item-1');
    expect(attempts.get(1)).toBe(2);
    expect(retried).toEqual([1]);
  });

  it('分片重试耗尽后抛错', async () => {
    const { deps } = makeDeps({
      putChunk: async () => {
        throw new ApiError({ kind: 'server', code: 10001, message: '持续失败' });
      },
    });
    await expect(uploadLargeFile(makeFile(10), { deps, maxChunkRetries: 0 })).rejects.toMatchObject({
      message: '持续失败',
    });
  });

  it('会话过期（30001）不退避重试，直接失败', async () => {
    let calls = 0;
    const { deps } = makeDeps({
      putChunk: async () => {
        calls += 1;
        throw new ApiError({ kind: 'not_found', code: 30001, message: '上传会话已过期' });
      },
    });

    await expect(uploadLargeFile(makeFile(10), { deps, maxChunkRetries: 3 })).rejects.toMatchObject({
      code: 30001,
    });
    // 三个分片各自失败一次即可，不做退避重试
    expect(calls).toBeLessThanOrEqual(3);
  });

  it('复用会话与已完成分片时不重复 init 与上传', async () => {
    const init = vi.fn();
    const { deps, putCalls } = makeDeps({ init });

    const states: ChunkedUploadState[] = [];
    await uploadLargeFile(makeFile(10), {
      deps,
      session: { upload_id: 'up-9', chunk_size: CHUNK, chunk_count: 3 },
      done: [0, 1],
      onState: (state) => states.push(state),
    });

    expect(init).not.toHaveBeenCalled();
    expect(putCalls.map((call) => call.index)).toEqual([2]);
    expect(states.at(-1)?.done.sort()).toEqual([0, 1, 2]);
  });

  it('取消信号立即中断', async () => {
    const controller = new AbortController();
    const { deps } = makeDeps({
      putChunk: async (_id, index) => {
        controller.abort();
        return { index, sha256: 'a' };
      },
    });

    await expect(
      uploadLargeFile(makeFile(10), { deps, signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('init 使用文件元信息与整体 sha256', async () => {
    const init = vi.fn(async () => ({ upload_id: 'up-1', chunk_size: CHUNK, chunk_count: 3 }));
    const { deps } = makeDeps({ init, sha256: async () => 'deadbeef' });

    await uploadLargeFile(makeFile(10, '报告.pdf'), { deps, title: '报告', tags: ['资料'] });

    expect(init).toHaveBeenCalledWith({
      original_name: '报告.pdf',
      size_bytes: 10,
      mime_type: 'application/octet-stream',
      sha256: 'deadbeef',
      title: '报告',
      tags: ['资料'],
    });
  });
});
