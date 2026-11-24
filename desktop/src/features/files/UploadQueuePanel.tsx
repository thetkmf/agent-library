import { Ban, CheckCircle2, PauseCircle, RotateCw, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/lib/cn';
import { formatSize } from './file-validation';
import { useUploadQueue, type UploadStatus, type UploadTask } from './useUploadQueue';

const STATUS_LABEL: Record<UploadStatus, string> = {
  queued: '排队中',
  uploading: '上传中',
  paused: '已暂停',
  done: '已完成',
  error: '失败',
  canceled: '已取消',
};

const STATUS_TONE: Record<UploadStatus, string> = {
  queued: 'text-muted',
  uploading: 'text-accent',
  paused: 'text-warning',
  done: 'text-success',
  error: 'text-danger',
  canceled: 'text-muted',
};

function TaskRow({ task }: { task: UploadTask }): JSX.Element {
  const { pause, resume, cancel, retry, remove } = useUploadQueue();
  const percent = Math.round(task.progress * 100);

  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs text-content" title={task.name}>
            {task.name}
          </span>
          <span className="shrink-0 text-[11px] text-muted">{formatSize(task.size)}</span>
          <span className={cn('shrink-0 text-[11px]', STATUS_TONE[task.status])} data-status={task.status}>
            {STATUS_LABEL[task.status]}
            {task.status === 'uploading' ? ` ${percent}%` : ''}
          </span>
          {task.attempts > 1 && task.status !== 'done' ? (
            <span className="shrink-0 text-[11px] text-muted">第 {task.attempts} 次</span>
          ) : null}
        </div>

        <div
          className="mt-1 h-1 w-full overflow-hidden rounded bg-sunken"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={`${task.name} 上传进度`}
        >
          <div
            className={cn(
              'h-full transition-[width] duration-ui',
              task.status === 'error' ? 'bg-danger' : task.status === 'done' ? 'bg-success' : 'bg-accent',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>

        {task.error ? (
          <p className="mt-1 text-[11px] text-danger" role="alert">
            {task.error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {task.status === 'uploading' ? (
          <IconButton size="sm" aria-label={`暂停 ${task.name}`} onClick={() => pause(task.id)}>
            <PauseCircle className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        ) : null}
        {task.status === 'paused' ? (
          <IconButton size="sm" aria-label={`继续 ${task.name}`} onClick={() => resume(task.id)}>
            <RotateCw className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        ) : null}
        {task.status === 'error' ? (
          <IconButton size="sm" aria-label={`重试 ${task.name}`} onClick={() => retry(task.id)}>
            <RotateCw className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        ) : null}
        {task.status === 'uploading' || task.status === 'queued' || task.status === 'paused' ? (
          <IconButton size="sm" aria-label={`取消 ${task.name}`} onClick={() => cancel(task.id)}>
            <Ban className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        ) : (
          <IconButton size="sm" aria-label={`移除 ${task.name}`} onClick={() => remove(task.id)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </li>
  );
}

/** 上传队列：进度、暂停/继续、取消、失败重试、清理已完成 */
export function UploadQueuePanel(): JSX.Element | null {
  const tasks = useUploadQueue((state) => state.tasks);
  const clearFinished = useUploadQueue((state) => state.clearFinished);

  if (tasks.length === 0) {
    return null;
  }

  const active = tasks.filter((task) => task.status === 'uploading' || task.status === 'queued').length;
  const failed = tasks.filter((task) => task.status === 'error').length;
  const finished = tasks.filter((task) => task.status === 'done').length;

  return (
    <section
      className="rounded-lg border border-border bg-elevated"
      aria-label="上传队列"
      data-testid="upload-queue"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-content">
          {failed > 0 ? (
            <XCircle className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
          ) : active > 0 ? (
            <PauseCircle className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          )}
          <span>
            上传队列：{active} 进行中 · {finished} 完成
            {failed > 0 ? ` · ${failed} 失败` : ''}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={clearFinished} data-testid="clear-finished">
          清理已完成
        </Button>
      </header>
      <ul className="divide-y divide-border">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </ul>
    </section>
  );
}
