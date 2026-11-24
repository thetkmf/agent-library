import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 必填：图标按钮没有可见文字，读屏依赖 aria-label */
  'aria-label': string;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'secondary';
}

const SIZE_CLASS: Record<'sm' | 'md', string> = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
};

const VARIANT_CLASS: Record<'ghost' | 'secondary', string> = {
  ghost: 'text-muted hover:bg-sunken hover:text-content',
  secondary: 'border border-border bg-elevated text-content hover:bg-sunken',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, size = 'md', variant = 'ghost', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded transition-colors duration-ui',
        'disabled:cursor-not-allowed disabled:text-muted/50',
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        className,
      )}
      {...rest}
    />
  );
});
