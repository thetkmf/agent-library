/**
 * 时间与数值格式化。接口时间为 UTC ISO 8601，展示层统一转本地时区。
 */

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 5) {
    return '刚刚';
  }
  if (seconds < 60) {
    return `${seconds} 秒前`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return formatDateTime(iso);
}

/** token 只显示首尾各 4 位，避免整串出现在界面上 */
export function maskSecret(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  if (value.length <= 12) {
    return '***';
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** 字节数 → 人类可读（1.2 GB），用于存储/文件展示 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex] ?? 'B'}`;
}
