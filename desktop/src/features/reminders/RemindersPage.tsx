import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, CheckCircle2, Clock } from 'lucide-react';
import { userMessageFor } from '@/api/errors';
import { queryKeys } from '@/api/keys';
import {
  useReminderMutations,
  useReminders,
  type Reminder,
  type RepeatRule,
} from '@/api/queries/reminders';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Panel } from '@/components/ui/Panel';
import { SkeletonList } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { useSystemEvents } from './useSystemEvents';

const REPEAT_LABEL: Record<RepeatRule, string> = {
  none: '不重复',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '待提醒',
  done: '已完成',
  snoozed: '已稍后',
  canceled: '已取消',
};

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** 提醒页（F8）：列表 + 创建 + 完成/稍后/取消 + 桌面通知 */
export function RemindersPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'done' | 'all'>('pending');
  const remindersQuery = useReminders(statusFilter === 'all' ? {} : { status: statusFilter });
  const mutations = useReminderMutations();

  const [title, setTitle] = useState('');
  const [remindAt, setRemindAt] = useState(() => toLocalInputValue(new Date(Date.now() + 600_000).toISOString()));
  const [repeatRule, setRepeatRule] = useState<RepeatRule>('none');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [dueBanners, setDueBanners] = useState<Array<{ id: string; title: string }>>([]);

  const reminders = useMemo(() => remindersQuery.data ?? [], [remindersQuery.data]);
  const now = Date.now();

  // 桌面通知：需要系统权限；被拒绝时降级为页面内提示
  const notify = useCallback((item: { id: string; title: string }) => {
    setDueBanners((previous) => [...previous, item]);
    if (typeof Notification === 'undefined') {
      return;
    }
    if (Notification.permission === 'granted') {
      new Notification('知识库提醒', { body: item.title });
      return;
    }
    if (Notification.permission === 'default') {
      void Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          new Notification('知识库提醒', { body: item.title });
        }
      });
    }
  }, []);

  useSystemEvents((event) => {
    if (event.event !== 'reminder.due') {
      return;
    }
    try {
      const payload = JSON.parse(event.data) as { reminder_id?: string; title?: string };
      const item = { id: String(payload.reminder_id ?? ''), title: String(payload.title ?? '提醒时间到') };
      notify(item);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all });
    } catch {
      // 忽略非法事件数据
    }
  });

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  const submit = (): void => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setFormError('提醒标题不能为空');
      return;
    }
    const when = new Date(remindAt);
    if (Number.isNaN(when.getTime())) {
      setFormError('提醒时间无效');
      return;
    }
    setFormError(null);
    mutations.create.mutate(
      {
        title: trimmed,
        remind_at: when.toISOString(),
        repeat_rule: repeatRule,
        body: body.trim().length > 0 ? body.trim() : null,
      },
      {
        onSuccess: () => {
          setTitle('');
          setBody('');
          setRepeatRule('none');
        },
        onError: (error) => setFormError(userMessageFor(error)),
      },
    );
  };

  return (
    <>
      {dueBanners.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning" role="status">
          <BellRing className="h-4 w-4" aria-hidden="true" />
          <span>提醒时间到：{dueBanners.map((item) => item.title).join('、')}</span>
          <Button size="sm" variant="ghost" onClick={() => setDueBanners([])}>
            知道了
          </Button>
        </div>
      ) : null}

      <Panel title="新建提醒" description="时间按本地时区填写，提交时转换为 UTC">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-muted">
              标题
              <input
                aria-label="提醒标题"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                placeholder="例如：复习向量检索笔记"
                className="rounded border border-border bg-elevated px-2 py-1.5 text-sm text-content outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              时间
              <input
                type="datetime-local"
                aria-label="提醒时间"
                value={remindAt}
                onChange={(event) => setRemindAt(event.target.value)}
                className="rounded border border-border bg-elevated px-2 py-1.5 text-sm text-content outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              重复
              <select
                aria-label="重复规则"
                value={repeatRule}
                onChange={(event) => setRepeatRule(event.target.value as RepeatRule)}
                className="rounded border border-border bg-elevated px-2 py-1.5 text-sm text-content outline-none focus:border-accent"
              >
                {(Object.keys(REPEAT_LABEL) as RepeatRule[]).map((rule) => (
                  <option key={rule} value={rule}>
                    {REPEAT_LABEL[rule]}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" variant="primary" onClick={submit} disabled={mutations.create.isPending} data-testid="create-reminder">
              {mutations.create.isPending ? '创建中…' : '创建提醒'}
            </Button>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted">
            备注（可选）
            <textarea
              aria-label="提醒备注"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={2}
              className="rounded border border-border bg-elevated px-2 py-1.5 text-sm text-content outline-none focus:border-accent"
            />
          </label>
          {formError ? (
            <p className="text-xs text-danger" role="alert">
              {formError}
            </p>
          ) : null}
        </div>
      </Panel>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-content">提醒列表</h2>
          <span className="text-xs text-muted">{reminders.length} 条</span>
        </div>
        <div className="flex items-center gap-0.5 rounded border border-border p-0.5" role="group" aria-label="状态筛选">
          {(['pending', 'done', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={statusFilter === value}
              onClick={() => setStatusFilter(value)}
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors duration-ui',
                statusFilter === value ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-sunken',
              )}
            >
              {value === 'all' ? '全部' : STATUS_LABEL[value]}
            </button>
          ))}
        </div>
      </div>

      {remindersQuery.isPending ? <SkeletonList rows={3} /> : null}
      {remindersQuery.isError ? (
        <ErrorState
          description={userMessageFor(remindersQuery.error)}
          onRetry={() => void remindersQuery.refetch()}
        />
      ) : null}

      {remindersQuery.isSuccess && reminders.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="没有提醒"
          description="创建提醒后，到点会收到桌面通知（需要系统通知权限）。"
          className="py-12"
        />
      ) : null}

      {reminders.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {reminders.map((reminder: Reminder) => {
            const overdue = reminder.status === 'pending' && new Date(reminder.remind_at).getTime() < now;
            return (
              <li
                key={reminder.id}
                className={cn(
                  'rounded-lg border bg-elevated px-3 py-2.5',
                  overdue ? 'border-danger/40' : 'border-border',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-content">{reminder.title}</span>
                  {overdue ? (
                    <span className="rounded border border-danger/30 bg-danger/10 px-1.5 py-0.5 text-[10px] text-danger">
                      已逾期
                    </span>
                  ) : null}
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                    {STATUS_LABEL[reminder.status] ?? reminder.status}
                  </span>
                  <span className="text-[11px] text-muted">
                    <Clock className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
                    {formatDateTime(reminder.remind_at)}（{formatRelativeTime(reminder.remind_at)}）
                  </span>
                  <span className="text-[11px] text-muted">{REPEAT_LABEL[reminder.repeat_rule as RepeatRule] ?? reminder.repeat_rule}</span>

                  <span className="ml-auto flex items-center gap-1">
                    {reminder.status === 'pending' || reminder.status === 'snoozed' ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => mutations.done.mutate(reminder.id)}
                          disabled={mutations.done.isPending}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          完成
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => mutations.snooze.mutate({ id: reminder.id, minutes: 10 })}
                          disabled={mutations.snooze.isPending}
                        >
                          稍后 10 分钟
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => mutations.remove.mutate(reminder.id)}
                          disabled={mutations.remove.isPending}
                        >
                          取消
                        </Button>
                      </>
                    ) : null}
                  </span>
                </div>
                {reminder.body ? <p className="mt-1 text-xs text-muted">{reminder.body}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {mutations.done.isError || mutations.snooze.isError || mutations.remove.isError ? (
        <ErrorState
          description={userMessageFor(
            mutations.done.error ?? mutations.snooze.error ?? mutations.remove.error,
          )}
          onRetry={() => void remindersQuery.refetch()}
          retryLabel="刷新列表"
        />
      ) : null}
    </>
  );
}
