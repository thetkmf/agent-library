import { Route, Routes } from 'react-router-dom';
import { NAV_ITEMS } from '@/app/nav-items';
import { PlannedPage, HomePage, NotFoundPage } from '@/features/placeholders/PlannedPage';
import { FilesPage } from '@/features/files/FilesPage';
import { NoteEditorPage } from '@/features/notes/NoteEditorPage';
import { NotesListPage } from '@/features/notes/NotesListPage';
import { NewNotePage } from '@/features/notes/NewNotePage';
import { SystemStatusPage } from '@/features/system/SystemStatusPage';
import { TimelinePage } from '@/features/timeline/TimelinePage';

/**
 * 路由表由导航定义驱动：已就绪功能挂真实页面，规划中功能挂占位页，
 * 保证侧边导航与路由永远一致（不会出现点不到的入口）。
 */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/notes" element={<NotesListPage />} />
      <Route path="/notes/new" element={<NewNotePage />} />
      <Route path="/notes/:itemId" element={<NoteEditorPage />} />
      <Route path="/files" element={<FilesPage />} />
      <Route path="/timeline" element={<TimelinePage />} />
      {NAV_ITEMS.filter((item) => item.stage === 'planned' || item.id === 'system-status').map((item) =>
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
