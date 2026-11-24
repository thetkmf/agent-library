/**
 * 分片上传（F5-2，契约 6.2）。
 *
 * 流程：`POST /uploads` 初始化 → 按 8 MB 切片并发 3 `PUT /uploads/{id}/chunks/{index}`
 * → `POST /uploads/{id}/complete`（后端校验整体 sha256）。
 *
 * 设计要点：
 * - 依赖注入（init/putChunk/complete/sha256），纯逻辑可单测；
 * - 分片失败按 index 重传，最多 `maxChunkRetries` 次；
 * - 会话与已完成分片通过 `onState` 回传，供队列在同一次运行内续传（不跨进程）；
 * - 整体 sha256 用 WebCrypto 计算，不发送文件内容以外的东西。
 */
import { apiRequest } from '@/api/client';
import { ApiError, toApiError } from '@/api/errors';
import type { components } from '@/api/generated';
import { CHUNK_CONCURRENCY } from './file-validation';

export type UploadInit = components['schemas']['UploadInitOut'];
export type UploadInitRequest = components['schemas']['UploadInitRequest'];
export type ChunkResult = components['schemas']['ChunkResult'];
export type ChunkedUploadResult = components['schemas']['UploadResult'];

export interface ChunkedUploadDeps {
  init: (payload: UploadInitRequest) => Promise<UploadInit>;
  putChunk: (uploadId: string, index: number, chunk: Blob) => Promise<ChunkResult>;
  complete: (uploadId: string) => Promise<ChunkedUploadResult>;
  sha256: (file: File) => Promise<string>;
  concurrency: number;
}

export const uploadsApi = {
  init: (payload: UploadInitRequest): Promise<UploadInit> =>
    apiRequest<UploadInit>('/uploads', { method: 'POST', body: payload, retries: 0 }),
  putChunk: (uploadId: string, index: number, chunk: Blob): Promise<ChunkResult> =>
    apiRequest<ChunkResult>(
      `/uploads/${encodeURIComponent(uploadId)}/chunks/${index}`,
      { method: 'PUT', blobBody: chunk, retries: 0, timeoutMs: 120_000 },
    ),
  complete: (uploadId: string): Promise<ChunkedUploadResult> =>
    apiRequest<ChunkedUploadResult>(`/uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: 'POST',
      retries: 0,
    }),
};

/** 文件整体 sha256（小写十六进制），用于 init 与 complete 校验 */
export async function sha256Hex(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export interface ChunkedUploadState {
  session: UploadInit | null;
  done: number[];
}

export interface ChunkedUploadOptions {
  title?: string;
  tags?: string[];
  signal?: AbortSignal;
  /** 0–1，按已完成分片数计算 */
  onProgress?: (ratio: number) => void;
  /** 会话与进度回传，便于本进程内重试续传 */
  onState?: (state: ChunkedUploadState) => void;
  onChunkRetry?: (index: number, attempt: number) => void;
  maxChunkRetries?: number;
  /** 复用已有会话（本进程内重试） */
  session?: UploadInit | null;
  done?: number[];
  deps?: Partial<ChunkedUploadDeps>;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ApiError({ kind: 'aborted', code: 'ABORTED', message: '上传已取消' });
  }
}

export async function uploadLargeFile(
  file: File,
  options: ChunkedUploadOptions = {},
): Promise<ChunkedUploadResult> {
  const deps: ChunkedUploadDeps = {
    ...uploadsApi,
    sha256: sha256Hex,
    concurrency: CHUNK_CONCURRENCY,
    ...options.deps,
  };
  const maxRetries = options.maxChunkRetries ?? 2;

  throwIfAborted(options.signal);

  let session = options.session ?? null;
  if (!session) {
    const sha256 = await deps.sha256(file);
    throwIfAborted(options.signal);
    session = await deps.init({
      original_name: file.name,
      size_bytes: file.size,
      mime_type: file.type || null,
      sha256,
      title: options.title ?? null,
      tags: options.tags ?? null,
    });
  }

  const done = new Set(options.done ?? []);
  const totalChunks = session.chunk_count;
  const chunkSize = session.chunk_size;
  const report = (): void => {
    const ratio = totalChunks === 0 ? 1 : done.size / totalChunks;
    options.onProgress?.(Math.min(1, ratio));
    options.onState?.({ session, done: [...done] });
  };
  report();

  const pending = Array.from({ length: totalChunks }, (_, index) => index).filter(
    (index) => !done.has(index),
  );

  const uploadChunk = async (index: number): Promise<void> => {
    const start = index * chunkSize;
    const chunk = file.slice(start, Math.min(start + chunkSize, file.size));

    for (let attempt = 0; ; attempt += 1) {
      throwIfAborted(options.signal);
      try {
        await deps.putChunk((session as UploadInit).upload_id, index, chunk);
        done.add(index);
        report();
        return;
      } catch (raw) {
        const error = toApiError(raw);
        if (error.kind === 'aborted') {
          throw error;
        }
        // 会话过期或分片缺失：直接失败，由界面引导重新上传
        if (error.code === 30001 || error.code === 40005) {
          throw error;
        }
        if (attempt >= maxRetries) {
          throw error;
        }
        options.onChunkRetry?.(index, attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
  };

  // 并发池：保持最多 concurrency 个在飞分片
  let cursor = 0;
  const workers = Array.from({ length: Math.min(deps.concurrency, Math.max(1, pending.length)) }, async () => {
    for (;;) {
      const next = pending[cursor];
      cursor += 1;
      if (next === undefined) {
        return;
      }
      await uploadChunk(next);
    }
  });
  await Promise.all(workers);

  throwIfAborted(options.signal);
  const result = await deps.complete(session.upload_id);
  options.onProgress?.(1);
  return result;
}
