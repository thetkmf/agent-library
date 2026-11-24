import { Route, Routes } from 'react-router-dom';
import { NAV_ITEMS } from '@/app/nav-items';
import { PlannedPage, HomePage, NotFoundPage } from '@/features/placeholders/PlannedPage';
import { SystemStatusPage } from '@/features/system/SystemStatusPage';

/**
 * 路由表由导航定义驱动：已就绪功能挂真实页面，规划中功能挂占位页，
 * 保证侧边导航与路由永远一致（不会出现点不到的入口）。
 */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      {NAV_ITEMS.map((item) =>
        item.stage === 'ready' ? (
          <Route key={item.path} path={item.path} element={<SystemStatusPage />} />
        ) : (
          <Route key={item.path} path={item.path} element={<PlannedPage item={item} />} />
        ),
      )}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
