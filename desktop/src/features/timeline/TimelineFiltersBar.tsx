import { useEffect, useMemo, useState } from 'react';
import { FilterX, Search } from 'lucide-react';
import type { Tag, TimelineGroupBy } from '@/api/timeline-types';
import type { ItemStatus, ItemType } from '@/api/queries/items';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import {
  DEFAULT_TIMELINE_FILTERS,
  TIMELINE_GROUP_BYS,
  TIMELINE_STATUSES,
  TIMELINE_TYPES,
  withFilters,
  type TimelineFilters,
} from './filters';

const GROUP_BY_LABEL: Record<TimelineGroupBy, string> = {
  day: '日',
  week: '周',
  month: '月',
};

const TYPE_LABEL: Record<ItemType, string> = {
  note: '笔记',
  tex: 'TeX',
  file: '文件',
};

const STATUS_LABEL: Record<ItemStatus, string> = {
  active: '正常',
  archived: '已归档',
  trashed: '回收站',
};

const QUERY_DEBOUNCE_MS = 400;

export interface TimelineFiltersBarProps {
  filters: TimelineFilters;
  tags: Tag[];
  tagsLoading?: boolean;
  selectionCount: number;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  onChange: (patch: Partial<TimelineFilters>) => void;
  onReset: () => void;
}

/** 时间轴筛选栏：所有控件改动都写回 URL（保持可刷新、可前进后退） */
export function TimelineFiltersBar({
  filters,
  tags,
  tagsLoading = false,
  selectionCount,
  selectMode,
  onToggleSelectMode,
  onChange,
  onReset,
}: TimelineFiltersBarProps): JSX.Element {
  const [keyword, setKeyword] = useState(filters.q);

  // URL 被外部改变（如前进/后退）时同步输入框
  useEffect(() => {
    setKeyword(filters.q);
  }, [filters.q]);

  // 关键字防抖 400ms 后写回 URL
  useEffect(() => {
    if (keyword === filters.q) {
      return;
    }
    const timer = setTimeout(() => onChange({ q: keyword }), QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword, filters.q, onChange]);

  const activeTag = useMemo(
    () => tags.find((tag) => tag.id === filters.tagId) ?? null,
    [tags, filters.tagId],
  );

  const isDefault =
    filters.groupBy === DEFAULT_TIMELINE_FILTERS.groupBy &&
    filters.types.length === 0 &&
    filters.status === DEFAULT_TIMELINE_FILTERS.status &&
    filters.tagId === null &&
    filters.q.length === 0 &&
    filters.createdFrom === null &&
    filters.createdTo === null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-elevated px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded border border-border p-0.5" role="group" aria-label="分组方式">
          {TIMELINE_GROUP_BYS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.groupBy === value}
              onClick={() => onChange({ groupBy: value })}
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors duration-ui',
                filters.groupBy === value ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-sunken',
              )}
            >
              按{GROUP_BY_LABEL[value]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="条目类型">
          {TIMELINE_TYPES.map((type) => {
            const active = filters.types.includes(type);
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onChange({
                    types: active ? filters.types.filter((entry) => entry !== type) : [...filters.types, type],
                  })
                }
                className={cn(
                  'rounded border px-2 py-1 text-xs transition-colors duration-ui',
                  active
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border text-muted hover:bg-sunken',
                )}
              >
                {TYPE_LABEL[type]}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-1 text-xs text-muted">
          状态
          <select
            value={filters.status}
            onChange={(event) => onChange({ status: event.target.value as ItemStatus })}
            className="rounded border border-border bg-elevated px-1.5 py-1 text-xs text-content outline-none focus:border-accent"
          >
            {TIMELINE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1 text-xs text-muted">
          标签
          <select
            aria-label="按标签筛选"
            value={filters.tagId ?? ''}
            onChange={(event) => onChange({ tagId: event.target.value || null })}
            disabled={tagsLoading}
            className="max-w-[160px] rounded border border-border bg-elevated px-1.5 py-1 text-xs text-content outline-none focus:border-accent"
          >
            <option value="">全部标签</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}（{tag.item_count}）
              </option>
            ))}
          </select>
        </label>

        <label className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted" aria-hidden="true" />
          <input
            type="search"
            aria-label="关键字"
            placeholder="标题 / 预览"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="w-40 rounded border border-border bg-elevated py-1 pl-7 pr-2 text-xs text-content outline-none focus:border-accent"
          />
        </label>

        <label className="flex items-center gap-1 text-xs text-muted">
          从
          <input
            type="date"
            aria-label="开始日期"
            value={filters.createdFrom ?? ''}
            onChange={(event) => onChange({ createdFrom: event.target.value || null })}
            className="rounded border border-border bg-elevated px-1.5 py-1 text-xs text-content outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          到
          <input
            type="date"
            aria-label="结束日期"
            value={filters.createdTo ?? ''}
            onChange={(event) => onChange({ createdTo: event.target.value || null })}
            className="rounded border border-border bg-elevated px-1.5 py-1 text-xs text-content outline-none focus:border-accent"
          />
        </label>

        <div className="ml-auto flex items-center gap-1.5">
          {!isDefault ? (
            <Button size="sm" variant="ghost" onClick={onReset}>
              <FilterX className="h-3.5 w-3.5" aria-hidden="true" />
              重置筛选
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={selectMode ? 'primary' : 'secondary'}
            onClick={onToggleSelectMode}
            aria-pressed={selectMode}
            data-testid="toggle-select-mode"
          >
            {selectMode ? `批量操作（${selectionCount}）` : '批量操作'}
          </Button>
        </div>
      </div>

      {activeTag ? (
        <p className="text-[11px] text-muted">
          当前标签：{activeTag.name} · {activeTag.item_count} 条
          <button
            type="button"
            className="ml-2 underline underline-offset-2 hover:text-content"
            onClick={() => onChange(withFilters(filters, { tagId: null }))}
          >
            清除
          </button>
        </p>
      ) : null}
    </div>
  );
}
