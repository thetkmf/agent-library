// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '@/app/routes';
import { NAV_ITEMS } from '@/app/nav-items';
import { BootstrapProvider } from '@/features/system/BootstrapProvider';
import { useUiStore } from '@/stores/ui-store';

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <BootstrapProvider>
        <AppRoutes />
      </BootstrapProvider>
    </MemoryRouter>,
  );
}

describe('AppRoutes', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiStore.setState({ themeMode: 'system', sidebarCollapsed: false });
  });

  it('工作台路由渲染占位说明', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: '工作台即将上线' })).toBeInTheDocument();
  });

  it('每个导航项都有可达页面（不会出现空白路由）', () => {
    for (const item of NAV_ITEMS) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[item.path]}>
          <BootstrapProvider>
            <AppRoutes />
          </BootstrapProvider>
        </MemoryRouter>,
      );
      if (item.stage === 'ready') {
        expect(screen.getByRole('region', { name: '本地后端' })).toBeInTheDocument();
      } else {
        expect(screen.getByRole('heading', { name: `${item.label}即将上线` })).toBeInTheDocument();
      }
      unmount();
    }
  });

  it('未知路径回到兜底页', () => {
    renderAt('/not-exists');
    expect(screen.getByRole('heading', { name: '页面不存在' })).toBeInTheDocument();
  });
});
