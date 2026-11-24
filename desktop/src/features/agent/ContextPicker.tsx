import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useItems } from '@/api/queries/items';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatRelativeTime } from '@/lib/format';

export interface ContextPickerProps {
  open: boolean;
  selected: string[];
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}

/**
 * 上下文选择器（F7-3）：从本地条目里挑选最多 20 条作为 `context_item_ids`。
 * 契约 9.6：超过 20 条或引用不存在的条目都会被后端拒绝，这里先做前端约束。
 */
export function ContextPicker({ open, selected, onClose, onConfirm }: ContextPickerProps): JSX.Element | null {
  const [keyword, setKeyword] = useState('');
  const [picked, setPicked] = useState<string[]>(selected);

  const query = useItems({ q: keyword.trim() || undefined, page_size: 20 });
  const items = useMemo(() => query.data?.items ?? [], [query.data]);

  if (!open) {
    return null;
  }

  const toggle = (id: string): void => {
    setPicked((previous) =>
      previous.includes(id) ? previous.filter((entry) => entry !== id) : [...previous, id].slice(0, 20),
    );
  };

  return (
    <Dialog
      open={open}
      title="选择引用条目"
      description="最多 20 条；对话时会把它们一起提供给模型作为上下文参考。"
      onClose={onClose}
      className="max-w-xl"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
            清空
          </Button>
          <Button size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              onConfirm(picked);
              onClose();
            }}
            data-testid="confirm-context"
          >
            确定（{picked.length}）
          </Button>
        </>
      }
    >
      <input
        type="search"
        aria-label="搜索条目标题"
        placeholder="搜索条目"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        className="w-full rounded border border-border bg-elevated px-2 py-1.5 text-xs text-content outline-none focus:border-accent"
      />

      <div className="pkb-scrollbar mt-2 max-h-64 overflow-y-auto">
        {query.isPending ? <Skeleton lines={3} /> : null}
        {items.length === 0 && !query.isPending ? (
          <p className="px-1 py-3 text-xs text-muted">没有可引用的条目，可先去「笔记」创建。</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-xs text-content hover:bg-sunken">
                  <input
                    type="checkbox"
                    checked={picked.includes(item.id)}
                    onChange={() => toggle(item.id)}
                    className="h-3.5 w-3.5 accent-[rgb(var(--pkb-accent))]"
                  />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="shrink-0 text-[10px] text-muted">{formatRelativeTime(item.updated_at)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-2 text-[11px] text-muted">
        需要更多条目？<Link to="/notes" className="text-accent underline underline-offset-2">去笔记列表</Link>
      </p>
    </Dialog>
  );
}
