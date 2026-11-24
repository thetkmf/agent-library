import type { MockMethod, MockRequest, MockRoute } from '@/mocks/router';
import { ok, fail } from '@/mocks/envelope';
import { API_ERROR_CODES } from '@/api/errors';

/** 测试辅助：快速构造 JSON mock 路由（不走产品代码里的 mock 目录） */
export function jsonRoute(
  id: string,
  method: MockMethod,
  pattern: RegExp,
  handler: (request: MockRequest, params: string[]) => unknown,
): MockRoute {
  return {
    id,
    method,
    pattern,
    handler: (request, params) => ok(handler(request, params)),
  };
}

export function route404(id: string, method: MockMethod, pattern: RegExp): MockRoute {
  return {
    id,
    method,
    pattern,
    handler: () => fail(API_ERROR_CODES.notFound, '资源不存在', 404),
  };
}

/** 常用响应数据 */
export const sampleReminder = {
  id: 'rem-1',
  title: '复习向量检索',
  body: '第 3 章',
  remind_at: '2026-11-24T12:00:00Z',
  repeat_rule: 'none',
  related_item_ids: [],
  status: 'pending',
  snooze_until: null,
  created_at: '2026-11-24T08:00:00Z',
  updated_at: '2026-11-24T08:00:00Z',
};

export const samplePlan = {
  id: 'plan-1',
  title: '机器学习基础',
  goal: '掌握检索与嵌入',
  start_date: '2026-11-01',
  target_date: '2026-12-31',
  status: 'active',
  version: 1,
  milestones: [
    {
      id: 'ms-1',
      plan_id: 'plan-1',
      title: '读完第 1 章',
      due_date: '2026-11-10',
      status: 'done',
      progress: 100,
      sort_order: 0,
      completed_at: '2026-11-09T10:00:00Z',
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-09T10:00:00Z',
    },
  ],
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-20T00:00:00Z',
};
