import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

const noopStorage: Storage = {
  length: 0,
  clear: () => undefined,
  getItem: () => null,
  key: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
};

export interface UiState {
  themeMode: ThemeMode;
  sidebarCollapsed: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

/**
 * 本地 UI 状态（Zustand）。
 * 只放界面偏好，不放服务端数据；服务端状态统一走 TanStack Query。
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      sidebarCollapsed: false,
      setThemeMode: (mode) => set({ themeMode: mode }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    }),
    {
      name: 'pkb.ui',
      version: 1,
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' && window.localStorage ? window.localStorage : noopStorage,
      ),
      partialize: (state) => ({
        themeMode: state.themeMode,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
