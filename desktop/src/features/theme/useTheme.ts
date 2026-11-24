import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'pkb.theme';

function readStoredMode(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
      return raw;
    }
  } catch {
    // localStorage 不可用（隐私模式）时回落到 system
  }
  return 'system';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'system') {
    return mode;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 主题切换：system 跟随操作系统，选择结果写入 localStorage 并同步到 <html data-theme> */
export function useTheme(): {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStoredMode()));

  useEffect(() => {
    const apply = (): void => {
      const next = resolveTheme(mode);
      setResolved(next);
      document.documentElement.dataset['theme'] = next;
    };
    apply();

    if (mode !== 'system') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  return { mode, resolved, setMode };
}
