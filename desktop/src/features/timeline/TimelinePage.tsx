import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, CheckSquare } from 'lucide-react';
import { userMessageFor } from '@/api/errors';
import {
  useTagBatch,
  useTags,
  useTimelineInfinite,
  type TagBatchMode,
  type TagBatchOutcome,
} from '@/api/queries/timeline';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonList } from '@/components/ui/Skeleton';
import { formatRelativeTime } from '@/lib/format';
import {
  buildTimelineRequest,
  filtersToSearchParams,
  parseTimelineFilters,
  withFilters,
  type TimelineFilters,
} from './filters';
import { mergeTimelineGroups } from './grouping';
import { flattenTimelineGroups, findRowIndexAt, measureRows } from './rows';
import { TagBatchBar } from './TagBatchBar';
import { TimelineCard } from './TimelineCard';
import { TimelineFiltersBar } from './TimelineFiltersBar';
import { useVirtualWindow } from './useVirtualWindow';

const PAGE_SIZE = 50;

/** 时间轴页（F4）：分组吸顶 + 虚拟滚动 + 标签筛选 + 批量打标 */
export function TimelinePage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = useMemo(() => parseTimelineFilters(searchParams), [searchParams]);
  const filters = parsed.filters;
  const hasFilterErrors = parsed.errors.length > 0;

  const request = useMemo(() => buildTimelineRequest(filters, { limit: PAGE_SIZE }), [filters]);
  const timeline = useTimelineInfinite(request, { enabled: !hasFilterErrors });
  const tagsQuery = useTags();
  const tags = tagsQuery.data ?? [];

  const updateFilters = useCallback(
    (patch: Partial<TimelineFilters>) => {
      const next = withFilters(filters, patch);
      setSearchParams(filtersToSearchParams(next), { replace: true });
    },
    [filters, setSearchParams],
  );

  const resetFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  const groups = useMemo(
    () => mergeTimelineGroups(timeline.data?.pages.map((page) => page.groups) ?? []),
    [timeline.data],
  );
  const rows = useMemo(() => flattenTimelineGroups(groups), [groups]);
  const { positions, totalHeight } = useMemo(() => measureRows(rows), [rows]);
  const virtual = useVirtualWindow({
    rowCount: rows.length,
    positions,
    totalHeight,
  });

  // 滚动到底部附近自动加载下一页
  const { atBottom } = virtual;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = timeline;
  useEffect(() => {
    if (!atBottom || !hasNextPage || isFetchingNextPage) {
      return;
    }
    void fetchNextPage();
  }, [atBottom, hasNextPage, isFetchingNextPage, fetchNextPage]);

  /** 吸顶显示当前滚动位置所属分组；该分组标题尚未滚出视口时不重复展示 */
  const stickyGroup = useMemo(() => {
    if (rows.length === 0) {
      return null;
    }
    const index = findRowIndexAt(positions, virtual.scrollTop + 1);
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const row = rows[cursor];
      if (row && row.kind === 'group') {
        const position = positions[cursor];
        // 分组行本身还完整可见时，不再叠加吸顶条
        if (position && position.top < virtual.scrollTop) {
          return row;
        }
        return null;
      }
    }
    return null;
  }, [rows, positions, virtual.scrollTop]);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [tagId, setTagId] = useState('');
  const [mode, setMode] = useState<TagBatchMode>('add');
  const [outcome, setOutcome] = useState<TagBatchOutcome | null>(null);
  const batch = useTagBatch();

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggleSelect = useCallback((itemId: string) => {
    setSelected((previous) =>
      previous.includes(itemId) ? previous.filter((id) => id !== itemId) : [...previous, itemId],
    );
  }, []);

  const toggleSelectMode = useCallback(() => {
    setSelectMode((previous) => {
      if (previous) {
        setSelected([]);
        setOutcome(null);
      }
      return !previous;
    });
  }, []);

  const runBatch = useCallback(
    (itemIds: string[]) => {
      if (!tagId || itemIds.length === 0) {
        return;
      }
      batch.mutate(
        { mode, tagId, itemIds },
        {
          onSuccess: (result) => {
            setOutcome(result);
            // 只保留失败项，便于一键重试
            setSelected(result.failed.map((entry) => entry.itemId));
          },
        },
      );
    },
    [batch, mode, tagId],
  );

  const totalItems = rows.reduce((sum, row) => (row.kind === 'item' ? sum + 1 : sum), 0);
  const visibleRows = useMemo(
    () => rows.slice(virtual.startIndex, virtual.endIndex + 1),
    [rows, virtual.startIndex, virtual.endIndex],
  );

  return (
    <>
      <TimelineFiltersBar
        filters={filters}
        tags={tags}
        tagsLoading={tagsQuery.isPending}
        selectionCount={selected.length}
        selectMode={selectMode}
        onToggleSelectMode={toggleSelectMode}
        onChange={updateFilters}
        onReset={resetFilters}
      />

      {hasFilterErrors ? (
        <ErrorState
          title="筛选条件不合法"
          description={parsed.errors.join('；')}
          action={
            <Button size="sm" onClick={resetFilters}>
              清空筛选
            </Button>
          }
        />
      ) : null}

      {!hasFilterErrors && timeline.isPending ? <SkeletonList rows={4} /> : null}

      {!hasFilterErrors && timeline.isError ? (
        <ErrorState
          description={userMessageFor(timeline.error)}
          onRetry={() => void timeline.refetch()}
          retryLabel="重新加载"
        />
      ) : null}

      {!hasFilterErrors && timeline.isSuccess && rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="该条件下没有条目"
          description="调整筛选条件，或先去「笔记」创建内容。"
          action={
            <Button size="sm" onClick={resetFilters}>
              清空筛选
            </Button>
          }
          className="py-12"
        />
      ) : null}

      {rows.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>
              已加载 {totalItems} 条 · 共 {groups.length} 组
              {selectMode ? <span className="ml-2 text-accent">已选 {selected.length} 条</span> : null}
            </span>
            <span>最近加载：{formatRelativeTime(timeline.dataUpdatedAt ? new Date(timeline.dataUpdatedAt).toISOString() : null)}</span>
          </div>

          <div
            ref={virtual.containerRef}
            onScroll={virtual.onScroll}
            className="pkb-scrollbar relative h-[calc(100vh-330px)] min-h-[360px] overflow-y-auto rounded-lg border border-border bg-surface"
            data-testid="timeline-scroller"
          >
            {stickyGroup ? (
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-elevated/95 px-3 py-2 backdrop-blur">
                <CheckSquare className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                <span className="text-xs font-medium text-content">{stickyGroup.label}</span>
                <span className="text-[11px] text-muted">{stickyGroup.count} 条</span>
              </div>
            ) : null}

            <div style={{ height: totalHeight, position: 'relative' }}>
              {visibleRows.map((row, offset) => {
                const index = virtual.startIndex + offset;
                const position = positions[index];
                if (!position) {
                  return null;
                }
                return (
                  <div
                    key={row.kind === 'group' ? `group-${row.key}` : `item-${row.item.id}`}
                    style={{
                      position: 'absolute',
                      top: position.top,
                      left: 0,
                      right: 0,
                      height: position.height,
                    }}
                  >
                    {row.kind === 'group' ? (
                      <div className="flex h-[36px] items-center gap-2 px-3">
                        <span className="text-xs font-semibold text-content">{row.label}</span>
                        <span className="text-[11px] text-muted">{row.count} 条</span>
                      </div>
                    ) : (
                      <TimelineCard
                        item={row.item}
                        selectable={selectMode}
                        selected={selectedSet.has(row.item.id)}
                        onToggleSelect={toggleSelect}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 py-1 text-xs text-muted">
            {timeline.isFetchingNextPage ? (
              <span>加载更多…</span>
            ) : timeline.hasNextPage ? (
              <Button size="sm" variant="secondary" onClick={() => void fetchNextPage()}>
                加载更多
              </Button>
            ) : (
              <span>已加载全部</span>
            )}
          </div>

          <TagBatchBar
            tags={tags}
            selectionCount={selected.length}
            tagId={tagId}
            mode={mode}
            pending={batch.isPending}
            outcome={outcome}
            onChangeTag={setTagId}
            onChangeMode={setMode}
            onApply={() => runBatch(selected)}
            onRetryFailed={() => runBatch((outcome?.failed ?? []).map((entry) => entry.itemId))}
            onClearSelection={() => {
              setSelected([]);
              setOutcome(null);
            }}
          />
        </div>
      ) : null}

      {batch.isError ? (
        <ErrorState description={userMessageFor(batch.error)} onRetry={() => runBatch(selected)} retryLabel="重试" />
      ) : null}
    </>
  );
}
