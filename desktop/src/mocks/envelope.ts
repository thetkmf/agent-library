import type { MockResponse } from './router';

/** 成功信封（契约 3.1） */
export function ok<T>(
  data: T,
  options: { status?: number; message?: string } = {},
): MockResponse {
  return {
    status: options.status ?? 200,
    body: {
      code: 0,
      message: options.message ?? 'ok',
      data,
      request_id: crypto.randomUUID(),
    },
  };
}

/** 失败信封（契约 3.2）：message 必须是可直接展示的中文短句 */
export function fail(
  code: number,
  message: string,
  status: number,
  extra: { data?: unknown; details?: unknown } = {},
): MockResponse {
  return {
    status,
    body: {
      code,
      message,
      data: extra.data ?? null,
      request_id: crypto.randomUUID(),
      ...(extra.details === undefined ? {} : { details: extra.details }),
    },
  };
}
