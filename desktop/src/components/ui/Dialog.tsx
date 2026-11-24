import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
  className?: string;
}

/** 轻量模态框：Esc 关闭、自动聚焦首个可交互元素、遮罩层拦截点击 */
export function Dialog({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  className,
}: DialogProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, textarea, select',
    );
    focusable?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'w-full max-w-md rounded-lg border border-border bg-elevated p-5 shadow-xl',
          className,
        )}
      >
        <h2 id={titleId} className="text-sm font-semibold text-content">
          {title}
        </h2>
        {description ? <p className="mt-2 text-xs leading-relaxed text-muted">{description}</p> : null}
        {children ? <div className="mt-3">{children}</div> : null}
        {footer ? <div className="mt-4 flex items-center justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
