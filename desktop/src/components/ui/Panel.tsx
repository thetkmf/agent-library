import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PanelProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** 通用内容容器：标题栏固定，正文区自适应 */
export function Panel({ title, description, actions, children, className }: PanelProps): JSX.Element {
  return (
    <section
      className={cn('flex flex-col overflow-hidden rounded-lg border border-border bg-elevated', className)}
      aria-label={title}
    >
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-content">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
