import { cn } from '@/lib/cn';
import type { SaveStatus } from './useAutosave';

const LABEL: Record<SaveStatus, string> = {
  idle: '未修改',
  dirty: '未保存',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
  conflict: '版本冲突',
};

const TONE: Record<SaveStatus, string> = {
  idle: 'text-muted',
  dirty: 'text-warning',
  saving: 'text-accent',
  saved: 'text-success',
  error: 'text-danger',
  conflict: 'text-danger',
};

export interface SaveStatusBadgeProps {
  status: SaveStatus;
  className?: string;
  /** 最近保存时间，展示在状态右侧 */
  savedAt?: string | null;
}

/** 编辑器保存状态：文字 + 颜色双通道，避免只靠颜色传达信息 */
export function SaveStatusBadge({ status, className, savedAt }: SaveStatusBadgeProps): JSX.Element {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs', TONE[status], className)}
      role="status"
      aria-live="polite"
      data-status={status}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'saved' && 'bg-success',
          status === 'saving' && 'animate-pulse bg-accent',
          status === 'dirty' && 'bg-warning',
          (status === 'error' || status === 'conflict') && 'bg-danger',
          status === 'idle' && 'bg-muted',
        )}
        aria-hidden="true"
      />
      {LABEL[status]}
      {status === 'saved' && savedAt ? <span className="text-muted">· {savedAt}</span> : null}
    </span>
  );
}
