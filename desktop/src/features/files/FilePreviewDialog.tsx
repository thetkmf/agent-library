import { useEffect, useMemo, useState } from 'react';
import { userMessageFor } from '@/api/errors';
import { filesApi, type FileAsset } from '@/api/queries/files';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatSize, previewKindOf } from './file-validation';

export interface FilePreviewDialogProps {
  open: boolean;
  asset: FileAsset | null;
  onClose: () => void;
}

/**
 * 预览：图片/纯文本通过带鉴权的下载接口取 blob，再用 object URL 渲染。
 * 关闭或卸载时撤销 object URL，避免内存泄漏；不拼本地文件路径。
 */
export function FilePreviewDialog({ open, asset, onClose }: FilePreviewDialogProps): JSX.Element | null {
  const [state, setState] = useState<
    | { phase: 'idle' }
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'text'; content: string }
    | { phase: 'image'; url: string }
  >({ phase: 'idle' });

  const kind = useMemo(
    () => (asset ? previewKindOf(asset.original_name, asset.mime_type) : 'none'),
    [asset],
  );

  useEffect(() => {
    if (!open || !asset || kind === 'none') {
      return;
    }
    let disposed = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();

    setState({ phase: 'loading' });
    filesApi
      .download(asset.id, { signal: controller.signal })
      .then(async (result) => {
        if (disposed) {
          return;
        }
        if (kind === 'text') {
          const content = await result.blob.text();
          if (!disposed) {
            setState({ phase: 'text', content: content.slice(0, 200_000) });
          }
          return;
        }
        objectUrl = URL.createObjectURL(result.blob);
        setState({ phase: 'image', url: objectUrl });
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setState({ phase: 'error', message: userMessageFor(error) });
        }
      });

    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [open, asset, kind]);

  if (!open || !asset) {
    return null;
  }

  return (
    <Dialog
      open={open}
      title={`预览：${asset.original_name}`}
      description={`${asset.mime_type} · ${formatSize(asset.size_bytes)}`}
      onClose={onClose}
      className="max-w-3xl"
      footer={
        <Button size="sm" onClick={onClose}>
          关闭
        </Button>
      }
    >
      {kind === 'none' ? (
        <p className="text-xs text-muted">该类型不支持在应用内预览，请下载后查看。</p>
      ) : null}

      {state.phase === 'loading' ? <Skeleton className="h-40 w-full" /> : null}

      {state.phase === 'error' ? (
        <ErrorState title="预览失败" description={state.message} />
      ) : null}

      {state.phase === 'text' ? (
        <pre className="pkb-scrollbar max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-sunken p-3 text-xs text-content">
          {state.content}
        </pre>
      ) : null}

      {state.phase === 'image' ? (
        <img src={state.url} alt={asset.original_name} className="max-h-[60vh] w-auto rounded border border-border" />
      ) : null}
    </Dialog>
  );
}
