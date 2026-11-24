import type { BackendState } from '@shared/ipc';

/** 后端状态 → 徽标文案/语气/提示，供状态徽标与页面复用 */
export type StatusTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export interface BackendStateMeta {
  label: string;
  tone: StatusTone;
  hint: string;
}

const STATE_META: Record<BackendState, BackendStateMeta> = {
  idle: { label: '待启动', tone: 'neutral', hint: '后端进程尚未启动' },
  starting: { label: '启动中', tone: 'progress', hint: '正在启动本地后端并等待健康检查' },
  ready: { label: '运行中', tone: 'success', hint: '本地后端已就绪，可以开始使用' },
  failed: { label: '启动失败', tone: 'danger', hint: '后端未能就绪，请查看错误信息或重启' },
  stopped: { label: '已停止', tone: 'neutral', hint: '后端进程已停止' },
};

export function getBackendStateMeta(state: BackendState): BackendStateMeta {
  return STATE_META[state];
}

export const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-sunken text-muted border-border',
  progress: 'bg-accent/10 text-accent border-accent/30',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
};
