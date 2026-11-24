import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileText, FolderOpen, Image as ImageIcon } from 'lucide-react';
import { userMessageFor } from '@/api/errors';
import { queryKeys } from '@/api/keys';
import { filesApi, useFileItems, type FileAsset } from '@/api/queries/files';
import type { Item } from '@/api/queries/items';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LinkButton } from '@/components/ui/LinkButton';
import { SkeletonList } from '@/components/ui/Skeleton';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { isMockEnabled } from '@/mocks';
import { FileDropZone } from './FileDropZone';
import { FilePreviewDialog } from './FilePreviewDialog';
import { UploadQueuePanel } from './UploadQueuePanel';
import { previewKindOf } from './file-validation';
import { setUploadListener, useUploadQueue, type UploadRejection } from './useUploadQueue';

function assetOf(item: Item): FileAsset | null {
  return item.file ?? null;
}

function FileRow({
  item,
  onPreview,
  onDownload,
  downloading,
}: {
  item: Item;
  onPreview: (asset: FileAsset) => void;
  onDownload: (item: Item) => void;
  downloading: boolean;
}): JSX.Element {
  const asset = assetOf(item);
  const kind = asset ? previewKindOf(asset.original_name, asset.mime_type) : 'none';
  const canPreview = kind !== 'none';

  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-elevated px-3 py-2.5">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded bg-sunken text-muted" aria-hidden="true">
        {kind === 'image' ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-medium text-content" title={item.title}>
            {asset?.original_name ?? item.title}
          </h3>
          {asset ? (
            <span className="shrink-0 text-[11px] text-muted">{formatBytes(asset.size_bytes)}</span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <span>{asset?.mime_type ?? '未知类型'}</span>
          <span>·</span>
          <span>{formatRelativeTime(item.created_at)}</span>
          {(item.tags ?? []).length > 0
            ? (item.tags ?? []).slice(0, 4).map((tag) => (
                <span key={tag.id} className="rounded border border-border px-1.5 py-0.5">
                  {tag.name}
                </span>
              ))
            : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => asset && onPreview(asset)}
          disabled={!canPreview}
          title={canPreview ? '预览' : '该类型不支持预览'}
          aria-label={`预览 ${item.title}`}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          预览
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onDownload(item)}
          disabled={!asset || downloading}
          aria-label={`下载 ${item.title}`}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          {downloading ? '下载中…' : '下载'}
        </Button>
      </div>
    </li>
  );
}

/** 文件页（F5-1）：上传队列 + 文件列表 + 下载/预览 */
export function FilesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const filesQuery = useFileItems();
  const addFiles = useUploadQueue((state) => state.add);

  const [rejections, setRejections] = useState<UploadRejection[]>([]);
  const [previewAsset, setPreviewAsset] = useState<FileAsset | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // 上传成功后刷新文件列表
  useEffect(() => {
    setUploadListener(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
    });
    return () => setUploadListener(null);
  }, [queryClient]);

  const handleFiles = useCallback(
    (files: File[]) => {
      const result = addFiles(files);
      setRejections(result.rejected);
    },
    [addFiles],
  );

  const handleDownload = useCallback(async (item: Item) => {
    const asset = assetOf(item);
    if (!asset) {
      return;
    }
    setDownloadingId(item.id);
    setDownloadError(null);
    try {
      const result = await filesApi.download(asset.id);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename ?? asset.original_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // 给浏览器留出下载启动时间后释放
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      setDownloadError(userMessageFor(error));
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const files = useMemo(() => filesQuery.data?.items ?? [], [filesQuery.data]);
  const isEmpty = filesQuery.isSuccess && files.length === 0;

  const totalSize = useMemo(
    () => files.reduce((sum, item) => sum + (item.file?.size_bytes ?? 0), 0),
    [files],
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-content">文件</h2>
          {filesQuery.data ? (
            <span className="text-xs text-muted">
              {files.length} 个 · 共 {formatBytes(totalSize)}
            </span>
          ) : null}
          {isMockEnabled() ? (
            <span className="rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
              Mock
            </span>
          ) : null}
        </div>
        <LinkButton size="sm" to="/notes">
          去写笔记
        </LinkButton>
      </div>

      <FileDropZone onFiles={handleFiles} />

      {rejections.length > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning" role="alert">
          <div className="flex items-start justify-between gap-3">
            <ul className="space-y-0.5">
              {rejections.map((entry) => (
                <li key={`${entry.name}-${entry.reason}`}>
                  {entry.name}：{entry.reason}
                </li>
              ))}
            </ul>
            <Button size="sm" variant="ghost" onClick={() => setRejections([])}>
              知道了
            </Button>
          </div>
        </div>
      ) : null}

      <UploadQueuePanel />

      {downloadError ? (
        <ErrorState title="下载失败" description={downloadError} onRetry={() => setDownloadError(null)} retryLabel="关闭" />
      ) : null}

      {filesQuery.isPending ? <SkeletonList rows={3} /> : null}

      {filesQuery.isError ? (
        <ErrorState
          description={userMessageFor(filesQuery.error)}
          onRetry={() => void filesQuery.refetch()}
          retryLabel="重新加载"
        />
      ) : null}

      {isEmpty ? (
        <EmptyState
          icon={FolderOpen}
          title="还没有文件"
          description="拖拽文件到上方区域，或点击「选择文件」上传。文件保存在本机数据目录。"
          hint="单文件超过 50 MB 将自动走分片上传（F5-2）"
          className="py-14"
        />
      ) : null}

      {files.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {files.map((item) => (
            <FileRow
              key={item.id}
              item={item}
              onPreview={setPreviewAsset}
              onDownload={(target) => void handleDownload(target)}
              downloading={downloadingId === item.id}
            />
          ))}
        </ul>
      ) : null}

      <FilePreviewDialog
        open={previewAsset !== null}
        asset={previewAsset}
        onClose={() => setPreviewAsset(null)}
      />
    </>
  );
}
