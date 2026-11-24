/** 文件校验与上传切片常量（契约 6.2 / 6.4） */

/** 小文件上限：超过后走分片上传（契约 6.1） */
export const SMALL_FILE_LIMIT_BYTES = 50 * 1024 * 1024;
/** 单文件总上限（契约 6.4，默认 2 GB，可在设置中调整） */
export const MAX_FILE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
/** 分片大小：契约默认 8 MB，范围 5–20 MB */
export const CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
/** 分片并发数：契约建议 3 */
export const CHUNK_CONCURRENCY = 3;

/** 允许扩展名默认值（契约 6.4；后端以 settings.allowed_extensions 为准） */
export const DEFAULT_ALLOWED_EXTENSIONS = [
  'md',
  'tex',
  'txt',
  'pdf',
  'docx',
  'pptx',
  'xlsx',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'svg',
  'mp3',
  'wav',
  'mp4',
  'zip',
] as const;

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : '';
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit] ?? 'B'}`;
}

export interface ValidateFileOptions {
  allowedExtensions?: readonly string[];
  maxBytes?: number;
}

/**
 * 上传前预校验：与后端保持同一套规则（扩展名白名单 + 小文件上限）。
 * 后端仍会再校验一次，这里只为提前给出可读提示。
 */
export function validateFile(
  file: { name: string; size: number },
  options: ValidateFileOptions = {},
): ValidationResult {
  const allowed = options.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;
  const extension = extensionOf(file.name);
  if (extension.length === 0 || !allowed.includes(extension)) {
    return {
      ok: false,
      reason: `不支持的文件类型${extension ? `（.${extension}）` : ''}，允许：${allowed.join('、')}`,
    };
  }
  if (file.size <= 0) {
    return { ok: false, reason: '文件为空' };
  }
  const maxBytes = options.maxBytes ?? MAX_FILE_LIMIT_BYTES;
  if (file.size > maxBytes) {
    return {
      ok: false,
      reason: `文件超过上限 ${formatSize(maxBytes)}`,
    };
  }
  return { ok: true };
}

/** 预览类型判定：只有图片与纯文本在前端预览，其余下载 */
export function previewKindOf(name: string, mimeType?: string | null): 'image' | 'text' | 'none' {
  const extension = extensionOf(name);
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(extension)) {
    return 'image';
  }
  if (['md', 'tex', 'txt', 'json', 'log', 'csv'].includes(extension)) {
    return 'text';
  }
  if (mimeType?.startsWith('image/')) {
    return 'image';
  }
  if (mimeType?.startsWith('text/')) {
    return 'text';
  }
  return 'none';
}

/** 上传路径规划：小文件单请求、大文件分片（契约 6.1/6.2） */
export function planUpload(size: number, limit: number = SMALL_FILE_LIMIT_BYTES): 'single' | 'chunked' {
  return size > limit ? 'chunked' : 'single';
}
