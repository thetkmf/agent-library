// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { Sidebar } from '@/components/layout/Sidebar';
import { NAV_ITEMS } from '@/app/nav-items';
import { useUiStore } from '@/stores/ui-store';

function renderSidebar(initialPath = '/notes'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiStore.setState({ themeMode: 'system', sidebarCollapsed: false });
  });

  it('渲染全部导航项并标注当前页', () => {
    renderSidebar('/search');
    const nav = screen.getByRole('navigation');
    for (const item of NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: new RegExp(item.label) })).toBeInTheDocument();
    }
    const active = within(nav).getByRole('link', { name: /检索/ });
    expect(active.className).toContain('text-accent');
    expect(active).toHaveAttribute('aria-current', 'page');
  });

  it('规划中功能显示「规划中」标记，就绪功能不显示', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /检索/ })).toHaveTextContent('规划中');
    expect(screen.getByRole('link', { name: /笔记/ })).not.toHaveTextContent('规划中');
  });

  it('可收起侧边栏，收起后保留可访问名称', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const toggle = screen.getByRole('button', { name: '收起侧边导航' });
    await act(async () => {
      await user.click(toggle);
    });

    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    // 折叠后文字进入 sr-only，但链接仍可通过 aria/文本访问
    expect(screen.getByRole('link', { name: /笔记/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开侧边导航' })).toBeInTheDocument();
  });
});
