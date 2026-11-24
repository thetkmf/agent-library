import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { queryKeys } from '@/api/keys';
import type { ItemType } from '@/api/queries/items';

/**
 * 检索与索引（契约 9.5）。B6 已合入，类型直接取自 `generated.ts`；
 * 生成类型里带默认值的字段是可选的，这里归一化成稳定形状后再给 UI 使用。
 */
import type { components } from '@/api/generated';

export type SearchMode = components['schemas']['SearchResponse']['mode'];
export type MatchType = components['schemas']['SearchHitOut']['match_type'];
export type SearchItemRef = components['schemas']['SearchItemRef'];
export type SearchHit = components['schemas']['SearchHitOut'];
export type SearchHitPage = components['schemas']['SearchResponse'];
export type IndexStatusRaw = components['schemas']['IndexStatusOut'];
export type IndexTask = components['schemas']['IndexTaskState'];
export type ReindexAccepted = components['schemas']['ReindexAccepted'];

export interface SearchResponse {
  items: SearchHit[];
  total: number;
  mode: SearchMode;
  degraded: boolean;
}

export interface IndexStatus {
  ready: boolean;
  indexed_count: number;
  pending_count: number;
  last_updated_at: string | null;
  embedding: { model: string; dimension: number; status: 'ready' | 'missing' | 'loading' | 'error' };
  task: IndexTask | null;
}

export interface SearchParams {
  q: string;
  mode?: SearchMode;
  limit?: number;
  type?: ItemType[];
  tag_id?: string[];
}

export interface EmbeddingStatus {
  model: string;
  dimension: number;
  status: 'ready' | 'missing' | 'loading' | 'error';
}

export interface ReindexInput {
  mode: 'incremental' | 'full';
}

export const SEARCH_QUERY_MAX = 200;

function normalizeSearchPage(page: SearchHitPage): SearchResponse {
  return {
    items: page.items ?? [],
    total: page.total ?? 0,
    mode: page.mode,
    degraded: page.degraded ?? false,
  };
}

function normalizeIndexStatus(status: IndexStatusRaw): IndexStatus {
  return {
    ready: status.ready,
    indexed_count: status.indexed_count,
    pending_count: status.pending_count,
    last_updated_at: status.last_updated_at ?? null,
    embedding: status.embedding,
    task: status.task ?? null,
  };
}

export const searchApi = {
  search: async (params: SearchParams, signal?: AbortSignal): Promise<SearchResponse> =>
    normalizeSearchPage(
      await apiRequest<SearchHitPage>('/search', {
        query: {
          q: params.q,
          mode: params.mode,
          limit: params.limit,
          type: params.type,
          tag_id: params.tag_id,
        },
        signal,
        retries: 0,
      }),
    ),
  status: async (): Promise<IndexStatus> =>
    normalizeIndexStatus(await apiRequest<IndexStatusRaw>('/index/status')),
  reindex: (input: ReindexInput): Promise<ReindexAccepted> =>
    apiRequest<ReindexAccepted>('/index/reindex', { method: 'POST', body: input, retries: 0 }),
};

/** 查询参数是否可发起检索：trim 后 1–200 字符 */
export function isSearchableQuery(q: string): boolean {
  const trimmed = q.trim();
  return trimmed.length >= 1 && trimmed.length <= SEARCH_QUERY_MAX;
}

export function useSearch(params: SearchParams | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.search.list(params ?? {}),
    queryFn: ({ signal }) => searchApi.search(params as SearchParams, signal),
    enabled: (options.enabled ?? true) && params !== null,
    retry: false,
    staleTime: 30_000,
    // 切换模式/翻页时保留上一批结果，避免闪白
    placeholderData: (previous) => previous,
  });
}

export function useIndexStatus(options: { enabled?: boolean; pollMs?: number } = {}) {
  const enabled = options.enabled ?? true;
  return useQuery({
    queryKey: queryKeys.search.indexStatus(),
    queryFn: searchApi.status,
    enabled,
    retry: false,
    staleTime: 5_000,
    refetchInterval: enabled ? (options.pollMs ?? 3_000) : false,
    // 页面隐藏时不轮询（契约 5.1 要求前端低频轮询）
    refetchIntervalInBackground: false,
  });
}

export function useReindex() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReindexInput) => searchApi.reindex(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.search.indexStatus() });
    },
  });
}
