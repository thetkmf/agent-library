import { cn } from '@/lib/cn';

export interface SkeletonProps {
  className?: string;
  /** 行数，默认 1；多行时每行宽度错落，更接近真实文本 */
  lines?: number;
}

/** 加载骨架屏：无文字语义，避免读屏重复播报 */
export function Skeleton({ className, lines = 1 }: SkeletonProps): JSX.Element {
  if (lines <= 1) {
    return <div className={cn('h-4 w-full animate-pulse rounded bg-sunken', className)} aria-hidden="true" />;
  }
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className={cn('h-4 animate-pulse rounded bg-sunken', index === lines - 1 ? 'w-2/3' : 'w-full', className)}
        />
      ))}
    </div>
  );
}

export interface SkeletonListProps {
  rows?: number;
}

/** 列表型加载态：卡片骨架，供各业务页复用 */
export function SkeletonList({ rows = 3 }: SkeletonListProps): JSX.Element {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="rounded-lg border border-border bg-elevated p-4">
          <Skeleton className="w-1/3" />
          <div className="mt-3">
            <Skeleton lines={2} />
          </div>
        </div>
      ))}
    </div>
  );
}
