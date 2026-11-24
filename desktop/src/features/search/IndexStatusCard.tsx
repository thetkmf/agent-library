import { Database, RefreshCw } from 'lucide-react';
import { userMessageFor } from '@/api/errors';
import { useIndexStatus, useReindex, type IndexStatus } from '@/api/queries/search';
import { Button } from '@/components/ui/Button';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

const EMBEDDING_LABEL: Record<IndexStatus['embedding']['status'], string> = {
  ready: '就绪',
  missing: '未安装',
  loading: '加载中',
  error: '异常',
};

const TASK_LABEL: Record<NonNullable<IndexStatus['task']>['status'], string> = {
  queued: '排队中',
  running: '索引中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
};

/**
 * 索引状态卡（F6-3）：展示就绪状态、已索引/待索引数量与嵌入模型，
 * 支持触发重建（202）并轮询任务进度；嵌入不可用时禁用重建并给出原因。
 */
export function IndexStatusCard(): JSX.Element {
  const statusQuery = useIndexStatus();
  const reindex = useReindex();

  const status = statusQuery.data;
  const embeddingReady = status?.embedding.status === 'ready';
  const busy = reindex.isPending || status?.task?.status === 'queued' || status?.task?.status === 'running';

  const trigger = (mode: 'incremental' | 'full'): void => {
    reindex.mutate({ mode });
  };

  return (
    <section
      className="rounded-lg border border-border bg-elevated px-3 py-2.5"
      aria-label="索引状态"
      data-testid="index-status-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Database className="h-4 w-4 text-muted" aria-hidden="true" />
        <span className="text-xs font-medium text-content">索引状态</span>

        {status ? (
          <>
            <span className={cn('text-[11px]', status.ready ? 'text-success' : 'text-warning')}>
              {status.ready ? '语义检索可用' : '语义检索不可用（已降级为关键词）'}
            </span>
            <span className="text-[11px] text-muted">
              已索引 {status.indexed_count} · 待索引 {status.pending_count}
            </span>
            <span className="text-[11px] text-muted">
              嵌入 {status.embedding.model}（{status.embedding.dimension} 维）·
              {EMBEDDING_LABEL[status.embedding.status]}
            </span>
            {status.last_updated_at ? (
              <span className="text-[11px] text-muted">最近更新 {formatDateTime(status.last_updated_at)}</span>
            ) : null}
            {status.task ? (
              <span className="text-[11px] text-accent">
                {TASK_LABEL[status.task.status]} {status.task.progress}%
              </span>
            ) : null}
          </>
        ) : statusQuery.isError ? (
          <span className="text-[11px] text-danger">状态读取失败</span>
        ) : (
          <span className="text-[11px] text-muted">读取中…</span>
        )}

        <span className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => trigger('incremental')}
            disabled={!embeddingReady || busy}
            title={embeddingReady ? '增量重建' : '嵌入模型不可用'}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            增量重建
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => trigger('full')}
            disabled={!embeddingReady || busy}
          >
            全量重建
          </Button>
        </span>
      </div>

      {reindex.isError ? (
        <p className="mt-1.5 text-[11px] text-danger" role="alert">
          重建失败：{userMessageFor(reindex.error)}
        </p>
      ) : null}

      {reindex.data ? (
        <p className="mt-1.5 text-[11px] text-success" role="status">
          已提交重建任务（{reindex.data.status}），进度会在上方刷新。
        </p>
      ) : null}
    </section>
  );
}
