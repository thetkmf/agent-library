import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { queryKeys } from '@/api/keys';
import type { components } from '@/api/generated';

/** 提醒（契约 9.7）。B9 已合入，类型取自 generated。 */
export type Reminder = components['schemas']['ReminderOut'];
export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly';
export type ReminderStatus = 'pending' | 'done' | 'snoozed' | 'canceled';

export interface ReminderCreateInput {
  title: string;
  remind_at: string;
  body?: string | null;
  repeat_rule?: RepeatRule;
  related_item_ids?: string[];
}

export interface ReminderUpdateInput {
  title?: string;
  remind_at?: string;
  body?: string | null;
  repeat_rule?: RepeatRule;
}

export const remindersApi = {
  list: async (query: { status?: string } = {}): Promise<Reminder[]> => {
    const page = await apiRequest<components['schemas']['ReminderPage']>('/reminders', {
      query: { page_size: 100, status: query.status },
      retries: 0,
    });
    return page.items ?? [];
  },
  create: (input: ReminderCreateInput): Promise<Reminder> =>
    apiRequest<Reminder>('/reminders', { method: 'POST', body: input, retries: 0 }),
  update: (id: string, input: ReminderUpdateInput): Promise<Reminder> =>
    apiRequest<Reminder>(`/reminders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      retries: 0,
    }),
  remove: (id: string): Promise<{ id: string }> =>
    apiRequest<{ id: string }>(`/reminders/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      retries: 0,
    }),
  snooze: (id: string, minutes: number): Promise<Reminder> =>
    apiRequest<Reminder>(`/reminders/${encodeURIComponent(id)}/snooze`, {
      method: 'POST',
      body: { minutes },
      retries: 0,
    }),
  done: (id: string): Promise<Reminder> =>
    apiRequest<Reminder>(`/reminders/${encodeURIComponent(id)}/done`, {
      method: 'POST',
      retries: 0,
    }),
};

export function useReminders(query: { status?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.reminders.list(query),
    queryFn: () => remindersApi.list(query),
    retry: false,
    staleTime: 15_000,
  });
}

export function useReminderMutations() {
  const queryClient = useQueryClient();
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all });
  };
  return {
    create: useMutation({ mutationFn: remindersApi.create, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: ReminderUpdateInput }) =>
        remindersApi.update(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: remindersApi.remove, onSuccess: invalidate }),
    snooze: useMutation({
      mutationFn: ({ id, minutes }: { id: string; minutes: number }) => remindersApi.snooze(id, minutes),
      onSuccess: invalidate,
    }),
    done: useMutation({ mutationFn: remindersApi.done, onSuccess: invalidate }),
  };
}
