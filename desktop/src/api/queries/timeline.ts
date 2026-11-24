import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type {
  AttachTagsRequest,
  Tag,
  TimelinePage,
} from '@/api/timeline-types';
import { userMessageFor } from '@/api/errors';
import { queryKeys } from '@/api/keys';
import type { TimelineRequest } from '@/features/timeline/filters';

/**
 * F4 数据源：`/timeline` 与 `/tags`（B3 已合入，走真实接口）。
 * 请求一律走 `apiRequest`（client.ts），信封、超时、错误映射保持一致。
 * 返回类型经 `src/api/timeline-types.ts` 归一化（生成的字段可选）。
 */
import type { components } from '@/api/generated';

export interface TimelinePageQuery extends TimelineRequest {
  cursor?: string;
}

function normalizeTimelinePage(page: components['schemas']['TimelineOut']): TimelinePage {
  return {
    groups: (page.groups ?? []).map((group) => ({
      key: group.key,
      label: group.label,
      item_count: group.item_count,
      items: group.items ?? [],
    })),
    next_cursor: page.next_cursor ?? null,
    has_more: page.has_more ?? false,
  };
}

export const timelineApi = {
  list: async (query: TimelinePageQuery): Promise<TimelinePage> =>
    normalizeTimelinePage(
      await apiRequest<components['schemas']['TimelineOut']>('/timeline', {
        query: {
          group_by: query.group_by,
          tz: query.tz,
          from: query.from,
          to: query.to,
          type: query.type,
          status: query.status,
          tag_id: query.tag_id,
          q: query.q,
          cursor: query.cursor,
          limit: query.limit,
        },
      }),
    ),
};

export function useTimelineInfinite(
  request: TimelineRequest,
  options: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: queryKeys.timeline.list(request),
    queryFn: ({ pageParam }) => timelineApi.list({ ...request, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.has_more && lastPage.next_cursor ? lastPage.next_cursor : undefined,
    enabled: options.enabled ?? true,
    retry: false,
    staleTime: 10_000,
  });
}

export const tagsApi = {
  list: async (): Promise<Tag[]> => (await apiRequest<Tag[] | null>('/tags')) ?? [],
  attach: (itemId: string, tagIds: string[]): Promise<unknown> => {
    const body: AttachTagsRequest = { tag_ids: tagIds };
    return apiRequest<unknown>(`/items/${encodeURIComponent(itemId)}/tags`, {
      method: 'POST',
      body,
      retries: 0,
    });
  },
  detach: (itemId: string, tagId: string): Promise<unknown> =>
    apiRequest<unknown>(
      `/items/${encodeURIComponent(itemId)}/tags/${encodeURIComponent(tagId)}`,
      { method: 'DELETE', retries: 0 },
    ),
};

export function useTags() {
  return useQuery({
    queryKey: queryKeys.tags.list(),
    queryFn: tagsApi.list,
    retry: false,
    staleTime: 10_000,
  });
}

export type TagBatchMode = 'add' | 'remove';

export interface TagBatchInput {
  mode: TagBatchMode;
  tagId: string;
  itemIds: string[];
}

export interface TagBatchFailure {
  itemId: string;
  message: string;
}

export interface TagBatchOutcome extends TagBatchInput {
  succeeded: string[];
  failed: TagBatchFailure[];
}

/**
 * 批量打标/移除：契约只有单条目接口，逐条调用并汇总结果。
 * 部分失败不抛异常，返回 `failed` 供页面提示并只重试失败项。
 */
export function useTagBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ mode, tagId, itemIds }: TagBatchInput): Promise<TagBatchOutcome> => {
      const settled = await Promise.allSettled(
        itemIds.map((itemId) =>
          mode === 'add' ? tagsApi.attach(itemId, [tagId]) : tagsApi.detach(itemId, tagId),
        ),
      );
      const succeeded: string[] = [];
      const failed: TagBatchFailure[] = [];
      settled.forEach((result, index) => {
        const itemId = itemIds[index];
        if (!itemId) {
          return;
        }
        if (result.status === 'fulfilled') {
          succeeded.push(itemId);
        } else {
          failed.push({ itemId, message: userMessageFor(result.reason) });
        }
      });
      return { mode, tagId, itemIds, succeeded, failed };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.timeline.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all });
    },
  });
}
