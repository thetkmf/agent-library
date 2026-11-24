import { describe, expect, it } from 'vitest';
import {
  buildApiBaseUrl,
  isAllowedExternalUrl,
  isAllowedNavigation,
} from '../../electron/lib/security-policy';

describe('isAllowedExternalUrl', () => {
  it('放行 http 与 https', () => {
    expect(isAllowedExternalUrl('https://example.com')).toBe(true);
    expect(isAllowedExternalUrl('http://127.0.0.1:5173/x')).toBe(true);
  });

  it('拦截危险协议', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'smb://host/share',
      'mailto:a@b.com',
      '',
    ]) {
      expect(isAllowedExternalUrl(url)).toBe(false);
    }
  });

  it('非字符串输入一律拒绝', () => {
    expect(isAllowedExternalUrl(null)).toBe(false);
    expect(isAllowedExternalUrl(42)).toBe(false);
    expect(isAllowedExternalUrl({})).toBe(false);
  });
});

describe('isAllowedNavigation', () => {
  const policy = { allowedOrigins: ['http://127.0.0.1:5173'], allowFileProtocol: true };

  it('允许应用自身 origin 与 file://', () => {
    expect(isAllowedNavigation('http://127.0.0.1:5173/#/notes', policy)).toBe(true);
    expect(isAllowedNavigation('file:///C:/app/dist/index.html', policy)).toBe(true);
  });

  it('禁止跳转到外部站点', () => {
    expect(isAllowedNavigation('https://evil.example.com', policy)).toBe(false);
    expect(isAllowedNavigation('http://127.0.0.1:5174/', policy)).toBe(false);
  });

  it('生产态可关闭 file:// 放行', () => {
    const strict = { allowedOrigins: [], allowFileProtocol: false };
    expect(isAllowedNavigation('file:///C:/app/dist/index.html', strict)).toBe(false);
  });
});

describe('buildApiBaseUrl', () => {
  it('拼接 /api/v1 前缀', () => {
    expect(buildApiBaseUrl(52341)).toBe('http://127.0.0.1:52341/api/v1');
  });
});
