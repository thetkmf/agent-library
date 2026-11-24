import { Link } from 'react-router-dom';
import { FileText, Sigma, File as FileIcon } from 'lucide-react';
import type { TimelineItem } from '@/api/timeline-types';
import { cn } from '@/lib/cn';
import { formatClockTime } from '@/lib/format';

const TYPE_META = {
  note: { label: '笔记', Icon: FileText, className: 'border-accent/30 bg-accent/10 text-accent' },
  tex: { label: 'TeX', Icon: Sigma, className: 'border-success/30 bg-success/10 text-success' },
  file: { label: '文件', Icon: FileIcon, className: 'border-border bg-sunken text-muted' },
} as const;

export interface TimelineCardProps {
  item: TimelineItem;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (itemId: string) => void;
}

/**
 * 时间轴条目卡片：固定高度（与虚拟滚动行高一致），点击进入编辑器。
 * 选择模式下显示复选框，点击卡片不跳转，避免误操作。
 */
export function TimelineCard({
  item,
  selectable = false,
  selected = false,
  onToggleSelect,
}: TimelineCardProps): JSX.Element {
  const meta = TYPE_META[item.type];
  const Icon = meta.Icon;

  const body = (
    <>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('rounded border px-1.5 py-0.5 text-[10px] leading-none', meta.className)}>
              {meta.label}
            </span>
            <h3 className="truncate text-sm font-medium text-content">{item.title}</h3>
            <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
              {formatClockTime(item.created_at)}
            </span>
          </div>
          {item.preview ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{item.preview}</p>
          ) : null}
          {(item.tags?.length ?? 0) > 0 ? (
            <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="标签">
              {(item.tags ?? []).slice(0, 4).map((tag) => (
                <li key={tag.id} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                  {tag.name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </>
  );

  return (
    <div className="h-full px-1">
      <div
        className={cn(
          'flex h-full items-start gap-2 rounded-lg border px-3 py-2.5 transition-colors duration-ui',
          selected ? 'border-accent bg-accent/5' : 'border-border bg-elevated hover:border-accent/40',
        )}
      >
        {selectable ? (
          <input
            type="checkbox"
            aria-label={`选择「${item.title}」`}
            checked={selected}
            onChange={() => onToggleSelect?.(item.id)}
            className="mt-1 h-3.5 w-3.5 shrink-0 accent-[rgb(var(--pkb-accent))]"
          />
        ) : null}
        {selectable ? (
          <div className="min-w-0 flex-1">{body}</div>
        ) : (
          <Link
            to={`/notes/${item.id}`}
            className="min-w-0 flex-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {body}
          </Link>
        )}
      </div>
    </div>
  );
}
