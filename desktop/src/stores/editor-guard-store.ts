import { create } from 'zustand';

interface EditorGuardState {
  /** 编辑页存在未保存改动时为 true，侧边导航离开前会二次确认 */
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
}

export const useEditorGuardStore = create<EditorGuardState>((set) => ({
  dirty: false,
  setDirty: (dirty) => set({ dirty }),
}));

/** 供非组件环境（导航回调）同步读取，避免闭包过期 */
export function confirmLeaveIfDirty(): boolean {
  if (!useEditorGuardStore.getState().dirty) {
    return true;
  }
  return window.confirm('当前内容尚未保存完成，确定离开吗？');
}
