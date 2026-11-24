import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/** 应用外壳：左侧导航 + 顶栏 + 主内容区，支持键盘跳过导航 */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex h-full bg-surface">
      <a
        href="#main-content"
        className="sr-only rounded bg-elevated px-3 py-2 text-sm text-content focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:border focus:border-accent"
      >
        跳到主内容
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main
          id="main-content"
          tabIndex={-1}
          className="pkb-scrollbar flex-1 overflow-y-auto px-6 py-6 focus:outline-none"
        >
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">{children}</div>
        </main>
        <footer className="flex shrink-0 items-center justify-between border-t border-border bg-elevated px-6 py-2 text-[11px] text-muted">
          <span>本地私有化 · 数据不出本机</span>
          <span>API v1 · 里程碑 M0</span>
        </footer>
      </div>
    </div>
  );
}
