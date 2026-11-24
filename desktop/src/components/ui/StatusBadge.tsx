import type { BackendState } from '@shared/ipc';
import { cn } from '@/lib/cn';
import { TONE_CLASS, getBackendStateMeta } from '@/features/system/backend-state';

export interface StatusBadgeProps {
  state: BackendState;
  className?: string;
}

export function StatusBadge({ state, className }: StatusBadgeProps): JSX.Element {
  const meta = getBackendStateMeta(state);
  return (
    <span
      data-testid="backend-status"
      data-state={state}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASS[meta.tone],
        className,
      )}
      title={meta.hint}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          meta.tone === 'success' && 'bg-success',
          meta.tone === 'danger' && 'bg-danger',
          meta.tone === 'progress' && 'animate-pulse bg-accent',
          meta.tone === 'warning' && 'bg-warning',
          meta.tone === 'neutral' && 'bg-muted',
        )}
        aria-hidden="true"
      />
      {meta.label}
    </span>
  );
}
