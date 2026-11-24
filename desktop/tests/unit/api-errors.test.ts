import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  ApiError,
  displayFallbackFor,
  isRetryableKind,
  kindForCode,
  kindForHttpStatus,
  toApiError,
  userMessageFor,
} from '@/api/errors';

describe('kindForCode', () => {
  it('按登记的错误码段归类', () => {
    expect(kindForCode(API_ERROR_CODES.unauthenticated)).toBe('auth');
    expect(kindForCode(API_ERROR_CODES.versionConflict)).toBe('conflict');
    expect(kindForCode(API_ERROR_CODES.notFound)).toBe('not_found');
    expect(kindForCode(API_ERROR_CODES.validation)).toBe('validation');
    expect(kindForCode(API_ERROR_CODES.rateLimited)).toBe('rate_limit');
    expect(kindForCode(API_ERROR_CODES.modelFailed)).toBe('ai');
    expect(kindForCode(API_ERROR_CODES.storageFull)).toBe('storage');
    expect(kindForCode(API_ERROR_CODES.unknown)).toBe('server');
  });

  it('未登记错误码归为 unknown', () => {
    expect(kindForCode(99999)).toBe('unknown');
  });
});

describe('kindForHttpStatus', () => {
  it('覆盖常见状态码', () => {
    expect(kindForHttpStatus(401)).toBe('auth');
    expect(kindForHttpStatus(404)).toBe('not_found');
    expect(kindForHttpStatus(409)).toBe('conflict');
    expect(kindForHttpStatus(413)).toBe('validation');
    expect(kindForHttpStatus(422)).toBe('validation');
    expect(kindForHttpStatus(429)).toBe('rate_limit');
    expect(kindForHttpStatus(503)).toBe('unavailable');
    expect(kindForHttpStatus(500)).toBe('server');
  });
});

describe('isRetryableKind', () => {
  it('仅网络/超时/5xx/限流可重试', () => {
    expect(isRetryableKind('network')).toBe(true);
    expect(isRetryableKind('timeout')).toBe(true);
    expect(isRetryableKind('server')).toBe(true);
    expect(isRetryableKind('rate_limit')).toBe(true);
    expect(isRetryableKind('validation')).toBe(false);
    expect(isRetryableKind('auth')).toBe(false);
    expect(isRetryableKind('conflict')).toBe(false);
  });
});

describe('userMessageFor', () => {
  it('优先使用后端中文 message', () => {
    const error = new ApiError({
      kind: 'validation',
      code: API_ERROR_CODES.validation,
      message: 'title 不能为空',
    });
    expect(userMessageFor(error)).toBe('title 不能为空');
  });

  it('message 为空时按语义兜底', () => {
    const error = new ApiError({ kind: 'network', code: 'NETWORK_ERROR', message: '' });
    expect(userMessageFor(error)).toBe(displayFallbackFor('network'));
  });

  it('非 ApiError 也能给出可读文案', () => {
    expect(userMessageFor(new Error('boom'))).toBe('boom');
    expect(userMessageFor(null)).toBe('操作失败，请稍后重试');
  });
});

describe('toApiError', () => {
  it('保留 ApiError', () => {
    const error = new ApiError({ kind: 'server', code: 10001, message: 'x' });
    expect(toApiError(error)).toBe(error);
  });

  it('AbortError 转为 aborted', () => {
    const converted = toApiError(new DOMException('aborted', 'AbortError'));
    expect(converted.kind).toBe('aborted');
  });

  it('普通异常转为 network', () => {
    const converted = toApiError(new Error('failed to fetch'));
    expect(converted.kind).toBe('network');
    expect(converted.code).toBe('NETWORK_ERROR');
  });

  it('未知值转为 unknown', () => {
    const converted = toApiError(42);
    expect(converted.kind).toBe('unknown');
    expect(converted.message.length).toBeGreaterThan(0);
  });
});
