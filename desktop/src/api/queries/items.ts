import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { components } from '@/api/generated';
import { queryKeys } from '@/api/keys';

/**
 * 条目相关类型。
 * B2 产出前后 `openapi.json` 尚无 `/items`，此时用本地契约类型（对齐《开发接口标准》8.1）；
 * B2 合入后改为 `components['schemas']['ItemOut']`。
 */
export type ItemType = 'note' | 'tex' | 'file';
export type ItemStatus = 'active' | 'archived' | 'trashed';

export interface TagRef {
  id: string;
  name: string;
}

export interface FileAsset {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  download_url: string;
  created_at: string;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  content: string | null;
  preview: string;
  tags: TagRef[];
  file: FileAsset | null;
  status: ItemStatus;
  version: number;
  embedding_status: 'pending' | 'indexed' | 'failed' | 'skipped';
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ItemPage {
  items: Item[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export interface ItemListQuery {
  page?: number;
  page_size?: number;
  type?: ItemType[];
  status?: ItemStatus;
  tag_id?: string;
  q?: string;
  created_from?: string;
  created_to?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface CreateItemInput {
  type: ItemType;
  title: string;
  content?: string;
  tags?: string[];
}

export const itemsApi = {
  list: (query: ItemListQuery = {}) =>
    apiRequest<ItemPage>('/items', {
      query: {
        page: query.page,
        page_size: query.page_size,
        type: query.type,
        status: query.status,
        tag_id: query.tag_id,
        q: query.q,
        created_from: query.created_from,
        created_to: query.created_to,
        sort: query.sort,
        order: query.order,
      },
    }),
  get: (id: string) => apiRequest<Item>(`/items/${encodeURIComponent(id)}`),
  content: (id: string) =>
    apiRequest<string>(`/items/${encodeURIComponent(id)}/content`, {
      expect: 'raw',
      responseType: 'text',
    }),
  create: (input: CreateItemInput, idempotencyKey?: string) =>
    apiRequest<Item>('/items', {
      method: 'POST',
      body: input,
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      retries: 0,
    }),
  patch: (id: string, body: { title?: string; status?: ItemStatus }) =>
    apiRequest<Item>(`/items/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  saveContent: (id: string, content: string, expectedVersion: number) =>
    apiRequest<Item>(`/items/${encodeURIComponent(id)}/content`, {
      method: 'PUT',
      textBody: content,
      query: { expected_version: expectedVersion },
      retries: 0,
    }),
};

export function useItems(query: ItemListQuery = {}) {
  return useQuery({
    queryKey: queryKeys.items.list(query),
    queryFn: () => itemsApi.list(query),
    retry: false,
    staleTime: 10_000,
  });
}

export function useItem(id: string | null) {
  return useQuery({
    queryKey: queryKeys.items.detail(id ?? ''),
    queryFn: () => itemsApi.get(id as string),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useItemContent(id: string | null) {
  return useQuery({
    queryKey: queryKeys.items.content(id ?? ''),
    queryFn: () => itemsApi.content(id as string),
    enabled: Boolean(id),
    retry: false,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
}

export interface CreateItemArgs {
  input: CreateItemInput;
  /** 同一页面实例复用同一幂等键，避免重复创建 */
  idempotencyKey?: string;
}

export function useCreateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: CreateItemArgs) =>
      itemsApi.create(input, idempotencyKey),
    onSuccess: (item) => {
      queryClient.setQueryData(queryKeys.items.detail(item.id), item);
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.lists() });
    },
  });
}

export function usePatchItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { title?: string; status?: ItemStatus } }) =>
      itemsApi.patch(id, body),
    onSuccess: (item) => {
      queryClient.setQueryData(queryKeys.items.detail(item.id), item);
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.lists() });
    },
  });
}

export interface SaveContentInput {
  id: string;
  content: string;
  expectedVersion: number;
}

export function useSaveContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content, expectedVersion }: SaveContentInput) =>
      itemsApi.saveContent(id, content, expectedVersion),
    onSuccess: (item) => {
      queryClient.setQueryData(queryKeys.items.detail(item.id), item);
    },
    onError: (error) => {
      // 版本冲突时把服务端当前对象写回详情缓存，供「刷新」路径使用
      if (error instanceof ApiError && error.isVersionConflict && error.details) {
        const current = error.details as Item;
        if (current && typeof current === 'object' && 'id' in current) {
          queryClient.setQueryData(queryKeys.items.detail(current.id), current);
        }
      }
    },
  });
}

/** 外部需要手动失效时使用（如上传成功后刷新列表） */
export function invalidateItems(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
}

export type GeneratedSchemas = components['schemas'];
