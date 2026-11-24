import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { NAV_SECTIONS } from '@/app/nav-items';
import { IconButton } from '@/components/ui/IconButton';
import { useUiStore } from '@/stores/ui-store';
import { cn } from '@/lib/cn';

/** 左侧主导航：可折叠，折叠后仅图标 + tooltip（title），保持键盘可达 */
export function Sidebar(): JSX.Element {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-elevated transition-[width] duration-ui',
        collapsed ? 'w-16' : 'w-56',
      )}
      aria-label="主导航"
    >
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-3">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded bg-accent/10 text-sm font-semibold text-accent"
          aria-hidden="true"
        >
          知
        </span>
        <span className={cn('truncate text-sm font-semibold text-content', collapsed && 'sr-only')}>
          个人知识库
        </span>
      </div>

      <nav className="pkb-scrollbar flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          <li>
            <NavLink
              to="/"
              end
              title={collapsed ? '工作台' : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded px-2 py-1.5 text-sm transition-colors duration-ui',
                  isActive ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-sunken hover:text-content',
                  collapsed && 'justify-center',
                )
              }
            >
              <span className={cn('truncate', collapsed && 'sr-only')}>工作台</span>
            </NavLink>
          </li>
        </ul>

        {NAV_SECTIONS.map((section) => (
          <div key={section.id} className="mt-4">
            <p
              className={cn(
                'px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted',
                collapsed && 'sr-only',
              )}
            >
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded px-2 py-1.5 text-sm transition-colors duration-ui',
                          isActive
                            ? 'bg-accent/10 font-medium text-accent'
                            : 'text-muted hover:bg-sunken hover:text-content',
                          collapsed && 'justify-center',
                        )
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
                      {!collapsed && item.stage === 'planned' ? (
                        <span className="ml-auto rounded border border-border px-1 py-px text-[10px] leading-none text-muted">
                          规划中
                        </span>
                      ) : null}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-2">
        <IconButton
          onClick={toggleSidebar}
          aria-label={collapsed ? '展开侧边导航' : '收起侧边导航'}
          aria-expanded={!collapsed}
          variant="ghost"
          className={cn('w-full', collapsed ? 'justify-center' : 'justify-start gap-2 px-2')}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          )}
        </IconButton>
      </div>
    </aside>
  );
}
