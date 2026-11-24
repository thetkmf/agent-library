import { HashRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { BootstrapProvider } from '@/features/system/BootstrapProvider';
import { AppRoutes } from './routes';

/**
 * 应用根组件。使用 HashRouter：生产态通过 file:// 加载，History 路由无法直接刷新。
 */
export function App(): JSX.Element {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <BootstrapProvider>
        <AppShell>
          <AppRoutes />
        </AppShell>
      </BootstrapProvider>
    </HashRouter>
  );
}
