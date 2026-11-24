import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { queryKeys } from '@/api/keys';
import type { ItemType } from '@/api/queries/items';

/**
 * 检索与索引（契约 9.5）。
 * B6 尚未产出 `/search`、`/index/status`，当前由 `src/mocks/search.ts` 提供；
 * B6 合入后删除 mock、重跑 `gen:api`，并把这里的类型换成 `generated.ts`。
 */
export type SearchMode = 'keyword' | 'semantic' | 'hybrid';
export type MatchType = 'keyword' | 'semantic';

/** 契约 9.5：结果里的 item 只有最小投影（id/type/title），正文用 snippet */
export interface SearchItemRef {
  id: string;
  type: ItemType;
  title: string;
}

export interface SearchHit {
  item: SearchItemRef;
  /** 0–1 归一化分数 */
  score: number;
  /** 纯文本片段，约 200 字符；前端自行高亮 */
  snippet: string;
  match_type: MatchType;
}

export interface SearchResponse {
  items: SearchHit[];
  /** 命中总数（可大于 items 长度） */
  total: number;
  /** 实际生效的模式（嵌入不可用时可能已降级） */
  mode: SearchMode;
  /** 是否因嵌入不可用而降级为关键词 */
  degraded: boolean;
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

export interface IndexTask {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  progress: number;
}

export interface IndexStatus {
  ready: boolean;
  indexed_count: number;
  pending_count: number;
  last_updated_at: string | null;
  embedding: EmbeddingStatus;
  task: IndexTask | null;
}

export interface ReindexInput {
  mode: 'incremental' | 'full';
}

export interface ReindexResult {
  task_id: string;
  type: 'reindex';
  status: 'queued' | 'running';
  progress: number;
}

export const SEARCH_QUERY_MAX = 200;

export const searchApi = {
  search: (params: SearchParams, signal?: AbortSignal): Promise<SearchResponse> =>
    apiRequest<SearchResponse>('/search', {
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
  status: (): Promise<IndexStatus> => apiRequest<IndexStatus>('/index/status'),
  reindex: (input: ReindexInput): Promise<ReindexResult> =>
    apiRequest<ReindexResult>('/index/reindex', { method: 'POST', body: input, retries: 0 }),
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
