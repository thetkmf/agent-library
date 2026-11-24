import { create } from 'zustand';
import { toApiError, userMessageFor } from '@/api/errors';
import { filesApi, type UploadResult } from '@/api/queries/files';
import { validateFile, type ValidationResult } from './file-validation';

export type UploadStatus = 'queued' | 'uploading' | 'paused' | 'done' | 'error' | 'canceled';

export interface UploadTask {
  id: string;
  file: File;
  name: string;
  size: number;
  status: UploadStatus;
  /** 0–1 */
  progress: number;
  error: string | null;
  attempts: number;
}

export interface UploadRejection {
  name: string;
  reason: string;
}

export interface AddFilesResult {
  accepted: UploadTask[];
  rejected: UploadRejection[];
}

interface UploadQueueState {
  tasks: UploadTask[];
  add: (files: File[]) => AddFilesResult;
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

const MAX_CONCURRENT = 2;
const controllers = new Map<string, AbortController>();
let uploadedListener: ((result: UploadResult) => void) | null = null;

/** 上传成功回调（页面用它失效文件列表缓存） */
export function setUploadListener(listener: ((result: UploadResult) => void) | null): void {
  uploadedListener = listener;
}

function newId(): string {
  return crypto.randomUUID();
}

export const useUploadQueue = create<UploadQueueState>((set, get) => {
  const patch = (id: string, changes: Partial<UploadTask>): void => {
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...changes } : task)),
    }));
  };

  const run = async (id: string): Promise<void> => {
    const task = get().tasks.find((entry) => entry.id === id);
    if (!task) {
      return;
    }
    const controller = new AbortController();
    controllers.set(id, controller);
    patch(id, { status: 'uploading', progress: 0, error: null, attempts: task.attempts + 1 });

    try {
      const result = await filesApi.upload(
        { file: task.file },
        {
          signal: controller.signal,
          onProgress: (progress) => patch(id, { progress: progress.ratio }),
        },
      );
      patch(id, { status: 'done', progress: 1 });
      uploadedListener?.(result);
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.kind === 'aborted') {
        patch(id, { status: 'canceled', error: null });
      } else {
        patch(id, { status: 'error', error: userMessageFor(apiError) });
      }
    } finally {
      controllers.delete(id);
      pump();
    }
  };

  const pump = (): void => {
    const state = get();
    const active = state.tasks.filter((task) => task.status === 'uploading').length;
    const slots = MAX_CONCURRENT - active;
    if (slots <= 0) {
      return;
    }
    const next = state.tasks.filter((task) => task.status === 'queued').slice(0, slots);
    for (const task of next) {
      void run(task.id);
    }
  };

  return {
    tasks: [],

    add: (files) => {
      const accepted: UploadTask[] = [];
      const rejected: UploadRejection[] = [];
      for (const file of files) {
        const validation: ValidationResult = validateFile(file);
        if (!validation.ok) {
          rejected.push({ name: file.name, reason: validation.reason });
          continue;
        }
        accepted.push({
          id: newId(),
          file,
          name: file.name,
          size: file.size,
          status: 'queued',
          progress: 0,
          error: null,
          attempts: 0,
        });
      }
      if (accepted.length > 0) {
        set((state) => ({ tasks: [...state.tasks, ...accepted] }));
        pump();
      }
      return { accepted, rejected };
    },

    pause: (id) => {
      controllers.get(id)?.abort();
      const task = get().tasks.find((entry) => entry.id === id);
      if (task && task.status === 'uploading') {
        patch(id, { status: 'paused' });
      }
    },

    resume: (id) => {
      const task = get().tasks.find((entry) => entry.id === id);
      if (!task || (task.status !== 'paused' && task.status !== 'error')) {
        return;
      }
      patch(id, { status: 'queued' });
      pump();
    },

    cancel: (id) => {
      controllers.get(id)?.abort();
      patch(id, { status: 'canceled', progress: 0, error: null });
    },

    retry: (id) => {
      const task = get().tasks.find((entry) => entry.id === id);
      if (!task) {
        return;
      }
      patch(id, { status: 'queued', progress: 0, error: null });
      pump();
    },

    remove: (id) => {
      controllers.get(id)?.abort();
      controllers.delete(id);
      set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }));
    },

    clearFinished: () => {
      set((state) => ({
        tasks: state.tasks.filter(
          (task) => task.status !== 'done' && task.status !== 'canceled',
        ),
      }));
    },
  };
});

/** 仅供测试：重置队列与并发控制状态 */
export function resetUploadQueueForTests(): void {
  for (const controller of controllers.values()) {
    controller.abort();
  }
  controllers.clear();
  uploadedListener = null;
  useUploadQueue.setState({ tasks: [] });
}
