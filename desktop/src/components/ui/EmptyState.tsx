import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  hint?: string;
  className?: string;
}

/** 空状态：说明为什么为空 + 下一步能做什么 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  hint,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-elevated px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-sunken text-muted" aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
      ) : null}
      <h3 className="text-sm font-semibold text-content">{title}</h3>
      {description ? <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-4 flex items-center gap-2">{action}</div> : null}
      {hint ? <p className="mt-3 text-[11px] text-muted/80">{hint}</p> : null}
    </div>
  );
}
