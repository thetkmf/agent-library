import { useLocation } from 'react-router-dom';
import { Monitor, Moon, Sun } from 'lucide-react';
import { findNavItem } from '@/app/nav-items';
import { IconButton } from '@/components/ui/IconButton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useBootstrapContext } from '@/features/system/bootstrap-context';
import { useTheme, type ThemeMode } from '@/features/theme/useTheme';

const NEXT_THEME: Record<ThemeMode, ThemeMode> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

const THEME_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

const THEME_ICON = {
  system: Monitor,
  light: Sun,
  dark: Moon,
} as const;

/** 顶部栏：当前页面标题 + 后端状态 + 主题切换 */
export function TopBar(): JSX.Element {
  const location = useLocation();
  const item = findNavItem(location.pathname);
  const { backend } = useBootstrapContext();
  const { mode, setMode } = useTheme();
  const ThemeIcon = THEME_ICON[mode];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-elevated px-6">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold text-content">{item?.label ?? '未找到页面'}</h1>
        {item?.description ? (
          <p className="truncate text-xs text-muted">{item.description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge state={backend?.state ?? 'idle'} />
        <IconButton
          onClick={() => setMode(NEXT_THEME[mode])}
          aria-label={`切换主题（当前：${THEME_LABEL[mode]}）`}
          title={`当前主题：${THEME_LABEL[mode]}，点击切换到${THEME_LABEL[NEXT_THEME[mode]]}`}
        >
          <ThemeIcon className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  );
}
