import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiDownload, apiUpload, type DownloadResult, type UploadProgress } from '@/api/client';
import type { components } from '@/api/generated';
import { queryKeys } from '@/api/keys';
import { useItems, type Item, type ItemListQuery } from './items';

export type FileAsset = components['schemas']['FileAssetOut'];
export type UploadResult = components['schemas']['UploadResult'];

export interface UploadInput {
  file: File;
  title?: string;
  tags?: string[];
}

export interface UploadRequestOptions {
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}

/** 文件接口封装：小文件上传（multipart）与带鉴权下载 */
export const filesApi = {
  upload: (input: UploadInput, options: UploadRequestOptions = {}) => {
    const form = new FormData();
    form.append('file', input.file);
    if (input.title && input.title.trim().length > 0) {
      form.append('title', input.title.trim());
    }
    if (input.tags && input.tags.length > 0) {
      form.append('tags', input.tags.join(','));
    }
    return apiUpload<UploadResult>('/files', {
      formData: form,
      signal: options.signal,
      onProgress: options.onProgress,
    });
  },
  download: (
    assetId: string,
    options: { signal?: AbortSignal; range?: string } = {},
  ): Promise<DownloadResult> =>
    apiDownload(`/files/${encodeURIComponent(assetId)}/download`, options),
};

const FILE_LIST_QUERY: ItemListQuery = { type: ['file'], page_size: 100 };

/** 文件列表统一用 `GET /items?type=file`（契约 13.14，不新增 GET /files） */
export function useFileItems() {
  return useItems(FILE_LIST_QUERY);
}

export function useUploadFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, options }: { input: UploadInput; options?: UploadRequestOptions }) =>
      filesApi.upload(input, options ?? {}),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.items.detail(result.item.id), result.item);
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.lists() });
    },
  });
}

export type FileItem = Item;
