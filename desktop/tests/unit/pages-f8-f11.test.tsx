// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApi, resetApiConfig } from '@/api/config';
import { createMockFetch, MOCK_BASE_URL, type MockRoute } from '@/mocks/router';
import { ok } from '@/mocks/envelope';
import { jsonRoute, samplePlan, sampleReminder } from '../fixtures/api-routes';
import { RemindersPage } from '@/features/reminders/RemindersPage';
import { LearningPage } from '@/features/learning/LearningPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

function createClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function setup(routes: MockRoute[]): void {
  resetApiConfig();
  configureApi({
    baseUrl: MOCK_BASE_URL,
    token: 'mock-token',
    fetchImpl: createMockFetch({ routes, latencyMs: 0 }),
    sleep: async () => undefined,
    random: () => 0.5,
  });
}

function renderPage(element: JSX.Element, path: string): void {
  render(
    <QueryClientProvider client={createClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('RemindersPage（F8）', () => {
  it('展示提醒并支持完成与稍后提醒', async () => {
    const done = vi.fn();
    const snooze = vi.fn();
    setup([
      jsonRoute('reminders.list', 'GET', /^\/reminders$/, () => ({
        items: [sampleReminder],
        page: 1,
        page_size: 100,
        total: 1,
        has_more: false,
      })),
      {
        id: 'reminders.done',
        method: 'POST',
        pattern: /^\/reminders\/([^/]+)\/done$/,
        handler: (_request, params) => {
          done(params[0]);
          return ok({ id: params[0] });
        },
      },
      {
        id: 'reminders.snooze',
        method: 'POST',
        pattern: /^\/reminders\/([^/]+)\/snooze$/,
        handler: (_request, params) => {
          snooze(params[0]);
          return ok({ id: params[0] });
        },
      },
    ]);
    // 上面两个自定义 handler 返回裸对象，这里改用标准信封包装
    const user = userEvent.setup();
    renderPage(<RemindersPage />, '/reminders');

    expect(await screen.findByText('复习向量检索')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '完成' }));
    await user.click(screen.getByRole('button', { name: '稍后 10 分钟' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(snooze).toHaveBeenCalled();
  });

  it('创建提醒时把本地时间转换为 UTC ISO', async () => {
    let posted: Record<string, unknown> | null = null;
    setup([
      jsonRoute('reminders.list', 'GET', /^\/reminders$/, () => ({
        items: [],
        page: 1,
        page_size: 100,
        total: 0,
        has_more: false,
      })),
      {
        id: 'reminders.create',
        method: 'POST',
        pattern: /^\/reminders$/,
        handler: (request) => {
          posted = JSON.parse(request.text) as Record<string, unknown>;
          return ok({ id: 'rem-new' });
        },
      },
    ]);

    const user = userEvent.setup();
    renderPage(<RemindersPage />, '/reminders');
    await screen.findByText('没有提醒');

    await user.type(screen.getByLabelText('提醒标题'), '写周报');
    await user.click(screen.getByTestId('create-reminder'));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted?.['title']).toBe('写周报');
    expect(String(posted?.['remind_at'])).toMatch(/Z$/);
  });
});

describe('LearningPage（F9）', () => {
  it('展示进度汇总与里程碑，并可新增里程碑', async () => {
    const created: Array<Record<string, unknown>> = [];
    setup([
      jsonRoute('learning.progress', 'GET', /^\/learning\/progress$/, () => ({
        total_plans: 3,
        active_plans: 1,
        done_plans: 1,
        completion_rate: 0.6,
        milestone_total: 5,
        milestone_done: 3,
        streak_days: 4,
        updated_at: '2026-11-24T08:00:00Z',
      })),
      jsonRoute('learning.plans', 'GET', /^\/learning\/plans$/, () => ({
        items: [samplePlan],
        page: 1,
        page_size: 50,
        total: 1,
        has_more: false,
      })),
      {
        id: 'learning.milestone',
        method: 'POST',
        pattern: /^\/learning\/plans\/([^/]+)\/milestones$/,
        handler: (request, params) => {
          created.push({ planId: params[0], ...(JSON.parse(request.text) as object) });
          return ok({ id: 'ms-new' });
        },
      },
    ]);

    const user = userEvent.setup();
    renderPage(<LearningPage />, '/learning');

    expect(await screen.findByText('完成率')).toBeInTheDocument();
    expect(await screen.findByText('60%')).toBeInTheDocument();
    expect(await screen.findByText('机器学习基础')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /机器学习基础/ }));
    expect(await screen.findByText('读完第 1 章')).toBeInTheDocument();

    await user.type(screen.getByLabelText('里程碑标题'), '做练习题');
    await user.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ planId: 'plan-1', title: '做练习题' });
  });
});

describe('SettingsPage（F11）', () => {
  const settings = {
    model: { provider: 'deepseek', name: 'deepseek-chat', base_url: 'https://api.deepseek.com', has_key: true },
    embedding: { model: 'bge-small-zh-v1.5', dimension: 512, status: 'missing' },
    storage: {
      data_dir: 'C:/data',
      allowed_extensions: ['md', 'pdf'],
      max_small_file_bytes: 52_428_800,
      max_file_bytes: 2_147_483_648,
    },
    ui: { theme: 'system' },
    privacy: { allow_external_calls: false },
    ai: { auto_organize_enabled: false },
  };

  function routes(onPatch?: (body: Record<string, unknown>) => void): MockRoute[] {
    return [
      jsonRoute('settings.get', 'GET', /^\/settings$/, () => settings),
      {
        id: 'settings.patch',
        method: 'PATCH',
        pattern: /^\/settings$/,
        handler: (request) => {
          onPatch?.(JSON.parse(request.text) as Record<string, unknown>);
          return ok(settings);
        },
      },
      jsonRoute('settings.test', 'POST', /^\/settings\/test-model$/, () => ({
        model: 'deepseek-chat',
        latency_ms: 123,
        ok: true,
      })),
      jsonRoute('profile.get', 'GET', /^\/profile$/, () => ({
        interests: ['检索'],
        knowledge_domains: [{ name: '机器学习', level: 2 }],
        learning_goals: ['掌握 RAG'],
        preferred_style: '简洁',
        updated_at: '2026-11-24T08:00:00Z',
      })),
    ];
  }

  it('展示密钥状态（不回显）与画像', async () => {
    setup(routes());
    renderPage(<SettingsPage />, '/settings');

    expect(await screen.findByText('已配置')).toBeInTheDocument();
    expect(screen.getByLabelText('DeepSeek API Key')).toHaveValue('');
    expect(await screen.findByText('检索')).toBeInTheDocument();
    expect(screen.getByText('掌握 RAG')).toBeInTheDocument();
    expect(screen.getByText(/bge-small-zh-v1.5/)).toBeInTheDocument();
  });

  it('保存模型时携带白名单模型且不发送空 Key', async () => {
    const patches: Array<Record<string, unknown>> = [];
    setup(routes((body) => patches.push(body)));
    const user = userEvent.setup();
    renderPage(<SettingsPage />, '/settings');
    await screen.findByText('已配置');

    await user.selectOptions(screen.getByLabelText('默认模型'), 'deepseek-reasoner');
    await user.click(screen.getByRole('button', { name: /保存/ }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({ model: { provider: 'deepseek', name: 'deepseek-reasoner' } });
    expect((patches[0]?.['model'] as Record<string, unknown>)['api_key']).toBeUndefined();
  });

  it('开启外联需要二次确认', async () => {
    const confirmSpy = vi.mocked(window.confirm);
    confirmSpy.mockReturnValue(false);
    const patches: Array<Record<string, unknown>> = [];
    setup(routes((body) => patches.push(body)));
    const user = userEvent.setup();
    renderPage(<SettingsPage />, '/settings');
    await screen.findByText('已配置');

    await user.click(screen.getByLabelText('允许对外调用'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(patches).toHaveLength(0);
  });

  it('测试模型连通性展示延迟', async () => {
    setup(routes());
    const user = userEvent.setup();
    renderPage(<SettingsPage />, '/settings');
    await screen.findByText('已配置');

    await user.click(screen.getByRole('button', { name: /测试连通性/ }));
    expect(await screen.findByText(/延迟 123 ms/)).toBeInTheDocument();
  });
});
