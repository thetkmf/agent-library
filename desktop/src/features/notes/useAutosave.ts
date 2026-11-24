import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, toApiError, userMessageFor } from '@/api/errors';
import { useSaveContent, type Item } from '@/api/queries/items';
import { clearDraft, saveDraft } from './drafts';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export const AUTOSAVE_DEBOUNCE_MS = 800;

export interface UseAutosaveOptions {
  itemId: string;
  initialContent: string;
  initialVersion: number;
  /** 冲突回调：携带服务端当前对象与本地内容，供界面弹出「刷新 / 覆盖」 */
  onConflict?: (current: Item | null, localContent: string) => void;
  debounceMs?: number;
}

export interface UseAutosaveResult {
  content: string;
  version: number;
  status: SaveStatus;
  error: string | null;
  hasUnsavedChanges: boolean;
  change: (next: string) => void;
  /** 立即保存（离开页面前或「重试」时调用） */
  flush: () => Promise<void>;
  /** 冲突后选择「使用服务端版本」：丢弃本地改动 */
  reloadFromServer: (next: { content: string; version: number }) => void;
  /** 冲突后选择「保留本地并覆盖」：以服务端版本为基线重写 */
  overwriteServer: (serverVersion: number) => Promise<void>;
}

/**
 * 自动保存：停止输入 800ms 后串行保存（同一时刻只允许一个写请求），
 * 成功即更新本地 version；409 时进入 conflict 态并保留本地草稿。
 */
export function useAutosave({
  itemId,
  initialContent,
  initialVersion,
  onConflict,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
}: UseAutosaveOptions): UseAutosaveResult {
  const [content, setContentState] = useState(initialContent);
  const [version, setVersionState] = useState(initialVersion);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const contentRef = useRef(initialContent);
  const savedContentRef = useRef(initialContent);
  const versionRef = useRef(initialVersion);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushingRef = useRef(false);
  const pendingRef = useRef(false);
  const forceRef = useRef(false);
  const onConflictRef = useRef(onConflict);
  onConflictRef.current = onConflict;

  const saveMutation = useSaveContent();
  const mutateAsyncRef = useRef(saveMutation.mutateAsync);
  mutateAsyncRef.current = saveMutation.mutateAsync;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(async (): Promise<void> => {
    clearTimer();
    if (flushingRef.current) {
      pendingRef.current = true;
      return;
    }
    flushingRef.current = true;
    try {
      for (;;) {
        const target = contentRef.current;
        if (target === savedContentRef.current && !forceRef.current) {
          break;
        }
        forceRef.current = false;
        setStatus('saving');
        setError(null);
        try {
          const item = await mutateAsyncRef.current({
            id: itemId,
            content: target,
            expectedVersion: versionRef.current,
          });
          versionRef.current = item.version;
          setVersionState(item.version);
          savedContentRef.current = item.content ?? target;
          clearDraft(itemId);
          setStatus('saved');
        } catch (raw) {
          const apiError = raw instanceof ApiError ? raw : toApiError(raw);
          if (apiError.isVersionConflict) {
            setStatus('conflict');
            const current = (apiError.details ?? null) as Item | null;
            onConflictRef.current?.(current, target);
          } else {
            setStatus('error');
            setError(userMessageFor(apiError));
          }
          break;
        }
        if (!pendingRef.current && contentRef.current === savedContentRef.current) {
          break;
        }
        pendingRef.current = false;
      }
    } finally {
      flushingRef.current = false;
    }
  }, [clearTimer, itemId]);

  const change = useCallback(
    (next: string) => {
      contentRef.current = next;
      setContentState(next);
      setStatus((previous) => (previous === 'saving' ? previous : 'dirty'));
      saveDraft(itemId, {
        content: next,
        baseVersion: versionRef.current,
        savedAt: new Date().toISOString(),
      });
      clearTimer();
      timerRef.current = setTimeout(() => {
        void flush();
      }, debounceMs);
    },
    [clearTimer, debounceMs, flush, itemId],
  );

  const reloadFromServer = useCallback(
    (next: { content: string; version: number }) => {
      clearTimer();
      contentRef.current = next.content;
      savedContentRef.current = next.content;
      versionRef.current = next.version;
      setContentState(next.content);
      setVersionState(next.version);
      setError(null);
      setStatus('saved');
      clearDraft(itemId);
    },
    [clearTimer, itemId],
  );

  const overwriteServer = useCallback(
    async (serverVersion: number) => {
      versionRef.current = serverVersion;
      setVersionState(serverVersion);
      forceRef.current = true;
      await flush();
    },
    [flush],
  );

  useEffect(() => {
    return () => {
      clearTimer();
      // 离开页面时尽力保存一次（不阻塞卸载）
      if (contentRef.current !== savedContentRef.current) {
        void mutateAsyncRef.current({
          id: itemId,
          content: contentRef.current,
          expectedVersion: versionRef.current,
        }).catch(() => undefined);
      }
    };
  }, [clearTimer, itemId]);

  const hasUnsavedChanges =
    status === 'dirty' || status === 'saving' || status === 'error' || status === 'conflict';

  return {
    content,
    version,
    status,
    error,
    hasUnsavedChanges,
    change,
    flush,
    reloadFromServer,
    overwriteServer,
  };
}
