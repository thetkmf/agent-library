import type { Tag } from '@/api/timeline-types';
import { Button } from '@/components/ui/Button';
import type { TagBatchMode, TagBatchOutcome } from '@/api/queries/timeline';
import { cn } from '@/lib/cn';

export interface TagBatchBarProps {
  tags: Tag[];
  selectionCount: number;
  tagId: string;
  mode: TagBatchMode;
  pending: boolean;
  outcome: TagBatchOutcome | null;
  onChangeTag: (tagId: string) => void;
  onChangeMode: (mode: TagBatchMode) => void;
  onApply: () => void;
  onRetryFailed: () => void;
  onClearSelection: () => void;
}

/**
 * 批量打标/移除操作条。
 * 契约只有单条目接口，逐条调用后汇总；部分失败时只重试失败项。
 */
export function TagBatchBar({
  tags,
  selectionCount,
  tagId,
  mode,
  pending,
  outcome,
  onChangeTag,
  onChangeMode,
  onApply,
  onRetryFailed,
  onClearSelection,
}: TagBatchBarProps): JSX.Element | null {
  const failed = outcome?.failed ?? [];
  const succeeded = outcome?.succeeded.length ?? 0;

  if (selectionCount === 0 && !outcome) {
    return null;
  }

  return (
    <div
      className="sticky bottom-0 z-20 mt-2 rounded-lg border border-border bg-elevated px-3 py-2 shadow-lg"
      role="region"
      aria-label="批量标签操作"
      data-testid="tag-batch-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-content">已选 {selectionCount} 条</span>

        <select
          aria-label="选择标签"
          value={tagId}
          onChange={(event) => onChangeTag(event.target.value)}
          className="max-w-[180px] rounded border border-border bg-elevated px-1.5 py-1 text-xs text-content outline-none focus:border-accent"
        >
          <option value="">选择标签…</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-0.5 rounded border border-border p-0.5" role="group" aria-label="操作类型">
          {(['add', 'remove'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => onChangeMode(value)}
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors duration-ui',
                mode === value ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-sunken',
              )}
            >
              {value === 'add' ? '添加标签' : '移除标签'}
            </button>
          ))}
        </div>

        <Button
          size="sm"
          variant="primary"
          onClick={onApply}
          disabled={!tagId || selectionCount === 0 || pending}
          data-testid="apply-tag-batch"
        >
          {pending ? '处理中…' : mode === 'add' ? '添加到所选' : '从所选移除'}
        </Button>

        <Button size="sm" variant="ghost" onClick={onClearSelection} disabled={pending}>
          取消选择
        </Button>

        {outcome ? (
          <span className="ml-auto text-[11px] text-muted" role="status" data-testid="tag-batch-summary">
            成功 {succeeded} 条
            {failed.length > 0 ? `，失败 ${failed.length} 条` : ''}
          </span>
        ) : null}

        {failed.length > 0 ? (
          <Button size="sm" variant="secondary" onClick={onRetryFailed} disabled={pending} data-testid="retry-failed">
            重试失败项（{failed.length}）
          </Button>
        ) : null}
      </div>

      {failed.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-danger" aria-label="失败详情">
          {failed.slice(0, 5).map((entry) => (
            <li key={entry.itemId} className="rounded border border-danger/30 bg-danger/5 px-1.5 py-0.5">
              {entry.itemId.slice(0, 8)}…：{entry.message}
            </li>
          ))}
          {failed.length > 5 ? <li>等 {failed.length} 条</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
