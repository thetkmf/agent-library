import { useCallback, useEffect, useState } from 'react';
import { useUiStore, type ThemeMode } from '@/stores/ui-store';

export type { ThemeMode };
export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'system') {
    return mode;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 主题状态存在 Zustand（持久化到 localStorage），并同步到 <html data-theme> */
export function useTheme(): {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
} {
  const mode = useUiStore((state) => state.themeMode);
  const setMode = useUiStore((state) => state.setThemeMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(mode));

  useEffect(() => {
    const apply = (): void => {
      const next = resolveTheme(mode);
      setResolved(next);
      document.documentElement.dataset['theme'] = next;
    };
    apply();

    if (mode !== 'system' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode]);

  const update = useCallback(
    (next: ThemeMode) => {
      setMode(next);
    },
    [setMode],
  );

  return { mode, resolved, setMode: update };
}
