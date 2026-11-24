import type { ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  description: string;
  code?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
  className?: string;
}

/** 错误态：给出可读原因 + 重试入口，不暴露堆栈 */
export function ErrorState({
  title = '加载失败',
  description,
  code,
  onRetry,
  retryLabel = '重试',
  action,
  className,
}: ErrorStateProps): JSX.Element {
  return (
    <div
      className={cn('rounded-lg border border-danger/40 bg-danger/5 px-5 py-4', className)}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-danger">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
          {code ? <p className="mt-1 font-mono text-[11px] text-muted/80">{code}</p> : null}
          <div className="mt-3 flex items-center gap-2">
            {onRetry ? (
              <Button size="sm" variant="primary" onClick={onRetry}>
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                {retryLabel}
              </Button>
            ) : null}
            {action}
          </div>
        </div>
      </div>
    </div>
  );
}
