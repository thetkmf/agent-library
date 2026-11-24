import type { ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '@/lib/cn';
import type { ButtonSize, ButtonVariant } from './Button';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong',
  secondary: 'border border-border bg-elevated text-content hover:bg-sunken',
  ghost: 'text-muted hover:bg-sunken hover:text-content',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
};

export interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

/** 与 Button 视觉一致的站内链接（Hash 路由跳转） */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: LinkButtonProps): JSX.Element {
  return (
    <Link
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors duration-ui',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
