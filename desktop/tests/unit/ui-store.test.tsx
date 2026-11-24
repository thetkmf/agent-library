// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useUiStore } from '@/stores/ui-store';

describe('useUiStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiStore.setState({ themeMode: 'system', sidebarCollapsed: false });
  });

  it('默认为跟随系统且侧栏展开', () => {
    const state = useUiStore.getState();
    expect(state.themeMode).toBe('system');
    expect(state.sidebarCollapsed).toBe(false);
  });

  it('切换主题时写入持久化存储', () => {
    act(() => {
      useUiStore.getState().setThemeMode('dark');
    });
    expect(useUiStore.getState().themeMode).toBe('dark');
    const raw = window.localStorage.getItem('pkb.ui');
    expect(raw).toContain('"themeMode":"dark"');
  });

  it('toggleSidebar 在展开与收起之间切换', () => {
    act(() => {
      useUiStore.getState().toggleSidebar();
    });
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    act(() => {
      useUiStore.getState().toggleSidebar();
    });
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });

  it('setSidebarCollapsed 支持显式设置', () => {
    act(() => {
      useUiStore.getState().setSidebarCollapsed(true);
    });
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });

  it('组件可从 store 读取状态', () => {
    function Probe(): JSX.Element {
      const themeMode = useUiStore((state) => state.themeMode);
      return <span data-testid="mode">{themeMode}</span>;
    }
    render(<Probe />);
    expect(screen.getByTestId('mode')).toHaveTextContent('system');
  });
});
