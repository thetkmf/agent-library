import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, Sparkles } from 'lucide-react';
import { userMessageFor } from '@/api/errors';
import type { ItemType } from '@/api/queries/items';
import { useSearch, type SearchHit, type SearchMode } from '@/api/queries/search';
import { useTags } from '@/api/queries/timeline';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonList } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { highlightSnippet } from './highlight';
import { IndexStatusCard } from './IndexStatusCard';
import {
  DEFAULT_SEARCH_MODE,
  SEARCH_MODES,
  SEARCH_TYPES,
  canSearch,
  parseSearchState,
  searchStateToParams,
  type SearchUrlState,
} from './search-state';

const MODE_LABEL: Record<SearchMode, string> = {
  keyword: '关键词',
  semantic: '语义',
  hybrid: '混合',
};

const TYPE_LABEL: Record<ItemType, string> = {
  note: '笔记',
  tex: 'TeX',
  file: '文件',
};

const MATCH_LABEL: Record<SearchHit['match_type'], string> = {
  keyword: '关键词命中',
  semantic: '语义命中',
};

const DEBOUNCE_MS = 300;
const PAGE_LIMIT = 20;

function ResultRow({ hit, query }: { hit: SearchHit; query: string }): JSX.Element {
  const parts = useMemo(() => highlightSnippet(hit.snippet, query), [hit.snippet, query]);

  return (
    <li className="rounded-lg border border-border bg-elevated px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/notes/${hit.item.id}`}
              className="truncate text-sm font-medium text-content underline-offset-2 hover:text-accent hover:underline"
            >
              {hit.item.title}
            </Link>
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
              {TYPE_LABEL[hit.item.type]}
            </span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px]',
                hit.match_type === 'semantic'
                  ? 'border border-success/30 bg-success/10 text-success'
                  : 'border border-accent/30 bg-accent/10 text-accent',
              )}
            >
              {MATCH_LABEL[hit.match_type]}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
              {hit.score.toFixed(2)}
            </span>
          </div>

          <p className="mt-1 text-xs leading-relaxed text-muted" data-testid="search-snippet">
            {parts.map((part, index) =>
              part.hit ? (
                <mark key={index} className="rounded bg-warning/25 px-0.5 text-content">
                  {part.text}
                </mark>
              ) : (
                <span key={index}>{part.text}</span>
              ),
            )}
          </p>
        </div>
      </div>
    </li>
  );
}

/** 检索页（F6）：防抖 + 取消、模式切换、片段高亮、索引态提示 */
export function SearchPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = useMemo(() => parseSearchState(searchParams), [searchParams]);
  const state = parsed.state;

  const [input, setInput] = useState(state.q);
  const [lastAutoSearch, setLastAutoSearch] = useState(state.q);

  // URL 被外部改变（前进/后退、点示例关键字）时同步输入框
  useEffect(() => {
    setInput(state.q);
    setLastAutoSearch(state.q);
  }, [state.q]);

  const apply = useCallback(
    (next: SearchUrlState) => {
      setSearchParams(searchStateToParams(next), { replace: true });
    },
    [setSearchParams],
  );

  const changeMode = (mode: SearchMode): void => apply({ ...state, mode });
  const toggleType = (type: ItemType): void => {
    const types = state.types.includes(type)
      ? state.types.filter((entry) => entry !== type)
      : [...state.types, type];
    apply({ ...state, types });
  };
  const changeTag = (tagId: string): void => apply({ ...state, tagIds: tagId ? [tagId] : [] });

  // 输入防抖 300ms 后写回 URL；查询 key 变化时 React Query 会取消上一个请求
  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === lastAutoSearch) {
      return;
    }
    const timer = setTimeout(() => {
      setLastAutoSearch(trimmed);
      apply({ ...state, q: trimmed });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, lastAutoSearch, apply, state]);

  const submitNow = (): void => {
    setLastAutoSearch(input.trim());
    apply({ ...state, q: input.trim() });
  };

  const searchable = canSearch(state, parsed.errors);
  const query = useSearch(
    searchable
      ? {
          q: state.q.trim(),
          mode: state.mode,
          limit: PAGE_LIMIT,
          type: state.types.length > 0 ? state.types : undefined,
          tag_id: state.tagIds.length > 0 ? state.tagIds : undefined,
        }
      : null,
    { enabled: searchable },
  );
  const tagsQuery = useTags();
  const tags = tagsQuery.data ?? [];

  const hits = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const degraded = query.data?.degraded ?? false;
  const effectiveMode = query.data?.mode ?? state.mode;

  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-elevated px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex min-w-[220px] flex-1 items-center">
            <SearchIcon className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted" aria-hidden="true" />
            <input
              type="search"
              aria-label="检索关键字"
              placeholder="搜索标题与正文，回车立即检索"
              value={input}
              maxLength={240}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submitNow();
                }
              }}
              className="w-full rounded border border-border bg-elevated py-1.5 pl-8 pr-2 text-sm text-content outline-none focus:border-accent"
            />
          </div>

          <div className="flex items-center gap-0.5 rounded border border-border p-0.5" role="group" aria-label="检索模式">
            {SEARCH_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={state.mode === mode}
                onClick={() => changeMode(mode)}
                className={cn(
                  'rounded px-2 py-1 text-xs transition-colors duration-ui',
                  state.mode === mode ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-sunken',
                )}
              >
                {MODE_LABEL[mode]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1" role="group" aria-label="条目类型">
            {SEARCH_TYPES.map((type) => {
              const active = state.types.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleType(type)}
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
            标签
            <select
              aria-label="按标签筛选"
              value={state.tagIds[0] ?? ''}
              onChange={(event) => changeTag(event.target.value)}
              className="max-w-[150px] rounded border border-border bg-elevated px-1.5 py-1 text-xs text-content outline-none focus:border-accent"
            >
              <option value="">全部标签</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>

          <Button size="sm" variant="primary" onClick={submitNow}>
            检索
          </Button>
        </div>
      </div>

      <IndexStatusCard />

      {parsed.errors.length > 0 ? (
        <ErrorState
          title="检索条件不合法"
          description={parsed.errors.join('；')}
          action={
            <Button size="sm" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
              重置条件
            </Button>
          }
        />
      ) : null}

      {degraded ? (
        <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning" role="status">
          嵌入模型不可用，已自动降级为关键词检索（实际模式：{MODE_LABEL[effectiveMode]}）。
        </div>
      ) : null}

      {!parsed.errors.length && state.q.trim().length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="输入关键字开始检索"
          description="支持关键词、语义与混合三种模式；语义模式需要索引就绪。"
          className="py-12"
        />
      ) : null}

      {query.isFetching ? <SkeletonList rows={3} /> : null}

      {query.isError ? (
        <ErrorState
          description={userMessageFor(query.error)}
          onRetry={() => void query.refetch()}
          retryLabel="重新检索"
        />
      ) : null}

      {query.isSuccess && !query.isFetching && hits.length === 0 && state.q.trim().length > 0 ? (
        <EmptyState
          title="没有匹配结果"
          description={`没有找到与「${state.q.trim()}」相关的内容，试试更短的关键字或切换检索模式。`}
          className="py-12"
        />
      ) : null}

      {hits.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-muted" data-testid="search-summary">
            命中 {total} 条 · 当前显示 {hits.length} 条 · 模式 {MODE_LABEL[effectiveMode]}
          </p>
          <ul className="flex flex-col gap-2">
            {hits.map((hit) => (
              <ResultRow key={hit.item.id} hit={hit} query={state.q} />
            ))}
          </ul>
          {total > hits.length ? (
            <p className="text-center text-[11px] text-muted">
              仅显示前 {hits.length} 条，请缩小关键字或使用类型/标签筛选
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-[11px] text-muted">
        默认模式：{MODE_LABEL[DEFAULT_SEARCH_MODE]}；片段由服务端返回纯文本，前端只做高亮。
      </p>
    </>
  );
}
