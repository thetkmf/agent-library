import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOWED_EXTENSIONS,
  MAX_FILE_LIMIT_BYTES,
  SMALL_FILE_LIMIT_BYTES,
  extensionOf,
  formatSize,
  previewKindOf,
  validateFile,
} from '@/features/files/file-validation';

describe('extensionOf', () => {
  it('取小写扩展名', () => {
    expect(extensionOf('笔记.MD')).toBe('md');
    expect(extensionOf('a.b.pdf')).toBe('pdf');
  });

  it('无扩展名返回空串', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
  });
});

describe('validateFile', () => {
  it('白名单内且不超限通过', () => {
    expect(validateFile({ name: 'a.pdf', size: 1024 })).toEqual({ ok: true });
  });

  it('扩展名不在白名单时给出可读原因', () => {
    const result = validateFile({ name: 'a.exe', size: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('.exe');
      expect(result.reason).toContain('不支持');
    }
  });

  it('空文件被拒绝', () => {
    const result = validateFile({ name: 'a.txt', size: 0 });
    expect(result.ok).toBe(false);
  });

  it('超过小文件上限仍允许（由队列改走分片），超过总上限才拒绝', () => {
    expect(validateFile({ name: 'a.zip', size: SMALL_FILE_LIMIT_BYTES + 1 })).toEqual({ ok: true });

    const tooLarge = validateFile({ name: 'a.zip', size: MAX_FILE_LIMIT_BYTES + 1 });
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) {
      expect(tooLarge.reason).toContain('超过上限');
    }
  });

  it('支持自定义白名单与上限', () => {
    expect(validateFile({ name: 'a.bin', size: 1 }, { allowedExtensions: ['bin'] })).toEqual({
      ok: true,
    });
    expect(validateFile({ name: 'a.txt', size: 5 }, { maxBytes: 4 }).ok).toBe(false);
  });

  it('默认白名单覆盖契约 6.4 的常见类型', () => {
    for (const extension of ['md', 'tex', 'pdf', 'png', 'mp4', 'zip']) {
      expect(DEFAULT_ALLOWED_EXTENSIONS).toContain(extension);
    }
  });
});

describe('previewKindOf', () => {
  it('按扩展名判定图片/文本/其他', () => {
    expect(previewKindOf('a.png')).toBe('image');
    expect(previewKindOf('a.md')).toBe('text');
    expect(previewKindOf('a.pdf')).toBe('none');
  });

  it('缺少扩展名时回落到 MIME', () => {
    expect(previewKindOf('noext', 'image/jpeg')).toBe('image');
    expect(previewKindOf('noext', 'text/plain')).toBe('text');
    expect(previewKindOf('noext', 'application/zip')).toBe('none');
  });
});

describe('formatSize', () => {
  it('按量级格式化', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(8 * 1024 * 1024)).toBe('8.0 MB');
  });
});
