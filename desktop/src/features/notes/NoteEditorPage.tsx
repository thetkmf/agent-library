import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Columns2, Eye, Pencil } from 'lucide-react';
import { ApiError, userMessageFor } from '@/api/errors';
import { queryKeys } from '@/api/keys';
import {
  itemsApi,
  useItem,
  useItemContent,
  usePatchItem,
  type Item,
} from '@/api/queries/items';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { useEditorGuardStore } from '@/stores/editor-guard-store';
import { CodeMirrorEditor } from './CodeMirrorEditor';
import { SaveStatusBadge } from './SaveStatusBadge';
import { clearDraft, loadDraft, type ItemDraft } from './drafts';
import { renderMarkdown } from './markdown';
import { renderTex } from './tex-preview';
import { useAutosave } from './useAutosave';

type ViewMode = 'split' | 'edit' | 'preview';

interface ConflictState {
  current: Item | null;
  localContent: string;
}

interface EditorWorkspaceProps {
  item: Item;
  initialContent: string;
}

function PreviewPane({ item, content }: { item: Item; content: string }): JSX.Element {
  const markdownHtml = useMemo(
    () => (item.type === 'tex' ? null : renderMarkdown(content)),
    [content, item.type],
  );
  const tex = useMemo(() => (item.type === 'tex' ? renderTex(content) : null), [content, item.type]);

  return (
    <div className="pkb-scrollbar h-full overflow-y-auto px-5 py-4" data-testid="preview-pane">
      {tex ? (
        tex.error ? (
          <div className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
            公式渲染失败：{tex.error}
          </div>
        ) : (
          <div className="flex justify-center text-content" dangerouslySetInnerHTML={{ __html: tex.html }} />
        )
      ) : (
        <article
          className="prose-pkb max-w-none text-sm leading-relaxed text-content"
          // renderMarkdown 已用 DOMPurify 白名单净化
          dangerouslySetInnerHTML={{ __html: markdownHtml ?? '' }}
        />
      )}
    </div>
  );
}

function EditorWorkspace({ item, initialContent }: EditorWorkspaceProps): JSX.Element {
  const queryClient = useQueryClient();
  const setDirty = useEditorGuardStore((state) => state.setDirty);
  const [view, setView] = useState<ViewMode>('split');
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [title, setTitle] = useState(item.title);
  const patchItem = usePatchItem();

  const autosave = useAutosave({
    itemId: item.id,
    initialContent,
    initialVersion: item.version,
    onConflict: (current, localContent) => setConflict({ current, localContent }),
  });

  // 未保存改动：导航离开时二次确认 + 关闭窗口提示
  useEffect(() => {
    setDirty(autosave.hasUnsavedChanges);
    return () => setDirty(false);
  }, [autosave.hasUnsavedChanges, setDirty]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!autosave.hasUnsavedChanges) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [autosave.hasUnsavedChanges]);

  // 本地草稿恢复（崩溃/刷新后）
  useEffect(() => {
    const existing = loadDraft(item.id);
    if (existing && existing.content !== initialContent) {
      setDraft(existing);
    }
  }, [item.id, initialContent]);

  const restoreDraft = (): void => {
    if (!draft) {
      return;
    }
    autosave.change(draft.content);
    setDraft(null);
  };

  const discardDraft = (): void => {
    clearDraft(item.id);
    setDraft(null);
  };

  const saveTitle = (): void => {
    const next = title.trim();
    if (next.length === 0 || next.length > 200) {
      setTitle(item.title);
      return;
    }
    if (next === item.title) {
      return;
    }
    patchItem.mutate({ id: item.id, body: { title: next } });
  };

  /** 冲突路径一：使用服务端版本（丢弃本地改动） */
  const refreshFromServer = async (): Promise<void> => {
    try {
      const [nextItem, nextContent] = await Promise.all([
        itemsApi.get(item.id),
        itemsApi.content(item.id),
      ]);
      queryClient.setQueryData(queryKeys.items.detail(nextItem.id), nextItem);
      queryClient.setQueryData(queryKeys.items.content(nextItem.id), nextContent);
      autosave.reloadFromServer({ content: nextContent, version: nextItem.version });
      setTitle(nextItem.title);
      setConflict(null);
    } catch {
      // 失败保留对话框，由用户重试
    }
  };

  /** 冲突路径二：保留本地内容并覆盖服务端 */
  const overwriteServer = async (): Promise<void> => {
    const serverVersion = conflict?.current?.version ?? item.version;
    setConflict(null);
    await autosave.overwriteServer(serverVersion);
  };

  const showEditor = view !== 'preview';
  const showPreview = view !== 'edit';

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/notes"
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-sunken hover:text-content"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            列表
          </Link>
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
            {item.type === 'tex' ? 'TeX' : '笔记'}
          </span>
          <input
            aria-label="标题"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            maxLength={200}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-content outline-none hover:border-border focus:border-accent"
          />
        </div>

        <div className="flex items-center gap-2">
          <SaveStatusBadge status={autosave.status} />
          <div className="flex items-center gap-0.5 rounded border border-border p-0.5" role="group" aria-label="视图">
            <IconButton
              size="sm"
              aria-label="仅编辑"
              aria-pressed={view === 'edit'}
              className={cn(view === 'edit' && 'bg-accent/10 text-accent')}
              onClick={() => setView('edit')}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton
              size="sm"
              aria-label="分屏"
              aria-pressed={view === 'split'}
              className={cn(view === 'split' && 'bg-accent/10 text-accent')}
              onClick={() => setView('split')}
            >
              <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton
              size="sm"
              aria-label="仅预览"
              aria-pressed={view === 'preview'}
              className={cn(view === 'preview' && 'bg-accent/10 text-accent')}
              onClick={() => setView('preview')}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            </IconButton>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void autosave.flush()}
            disabled={!autosave.hasUnsavedChanges}
            data-testid="save-now"
          >
            立即保存
          </Button>
        </div>
      </div>

      {autosave.status === 'error' ? (
        <ErrorState
          title="保存失败"
          description={autosave.error ?? '请稍后重试'}
          onRetry={() => void autosave.flush()}
          retryLabel="重试保存"
        />
      ) : null}

      {draft ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <span>
            检测到未保存的本地草稿（{formatDateTime(draft.savedAt)}，基于 v{draft.baseVersion}）
          </span>
          <span className="flex items-center gap-2">
            <Button size="sm" onClick={restoreDraft}>
              恢复草稿
            </Button>
            <Button size="sm" variant="ghost" onClick={discardDraft}>
              丢弃
            </Button>
          </span>
        </div>
      ) : null}

      <div className="flex min-h-[420px] flex-1 gap-3 lg:h-[calc(100vh-260px)]">
        {showEditor ? (
          <div className={cn('min-h-0 overflow-hidden rounded-lg border border-border bg-elevated', showPreview ? 'flex-1' : 'w-full')}>
            <CodeMirrorEditor
              value={autosave.content}
              language={item.type === 'tex' ? 'tex' : 'markdown'}
              onChange={autosave.change}
            />
          </div>
        ) : null}
        {showPreview ? (
          <div className={cn('min-h-0 overflow-hidden rounded-lg border border-border bg-elevated', showEditor ? 'flex-1' : 'w-full')}>
            <PreviewPane item={item} content={autosave.content} />
          </div>
        ) : null}
      </div>

      <p className="text-[11px] text-muted">
        自动保存：停止输入 800ms 后保存（v{autosave.version} · {formatDateTime(item.updated_at)} 为服务端时间）
      </p>

      <Dialog
        open={conflict !== null}
        title="版本冲突"
        description="内容已被其他窗口修改。可以保留本地内容覆盖服务端，或使用服务端版本刷新（本地草稿会先保留）。"
        onClose={() => setConflict(null)}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>
              稍后处理
            </Button>
            <Button size="sm" onClick={() => void refreshFromServer()}>
              使用服务端版本
            </Button>
            <Button size="sm" variant="primary" onClick={() => void overwriteServer()}>
              保留本地并覆盖
            </Button>
          </>
        }
      >
        <dl className="flex flex-col gap-1 text-xs text-muted">
          <div className="flex justify-between gap-4">
            <dt>服务端版本</dt>
            <dd className="font-mono text-content">
              v{conflict?.current?.version ?? '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>服务端更新时间</dt>
            <dd className="text-content">{formatDateTime(conflict?.current?.updated_at)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>本地内容长度</dt>
            <dd className="text-content">{conflict?.localContent.length ?? 0} 字符</dd>
          </div>
        </dl>
      </Dialog>
    </>
  );
}

/** 编辑器页（F3）：处理加载 / 404 / 错误，再交给 workspace */
export function NoteEditorPage(): JSX.Element {
  const { itemId } = useParams<{ itemId: string }>();
  const itemQuery = useItem(itemId ?? null);
  const contentQuery = useItemContent(itemId ?? null);

  if (!itemId) {
    return <EmptyState title="缺少条目 ID" description="请从列表进入条目。" />;
  }

  if (itemQuery.isPending || contentQuery.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  const error = itemQuery.error ?? contentQuery.error;
  if (error) {
    const apiError = error instanceof ApiError ? error : null;
    if (apiError?.kind === 'not_found') {
      return (
        <EmptyState
          title="条目不存在"
          description="可能已被删除，或链接已失效。"
          action={
            <Link
              to="/notes"
              className="rounded border border-border bg-elevated px-3 py-1.5 text-xs text-content hover:bg-sunken"
            >
              返回列表
            </Link>
          }
        />
      );
    }
    return (
      <ErrorState
        description={userMessageFor(error)}
        onRetry={() => {
          void itemQuery.refetch();
          void contentQuery.refetch();
        }}
        retryLabel="重新加载"
      />
    );
  }

  if (!itemQuery.data || contentQuery.data === undefined) {
    return <ErrorState description="条目数据缺失，请重新加载" onRetry={() => void itemQuery.refetch()} />;
  }

  return <EditorWorkspace item={itemQuery.data} initialContent={contentQuery.data} />;
}
