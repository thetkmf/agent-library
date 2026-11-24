import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { queryKeys } from '@/api/keys';
import type { components } from '@/api/generated';

/** 设置、模型连通性与画像（契约 9.10 / B12）。 */
export type Settings = components['schemas']['SettingsOut'];
export type SettingsPatch = components['schemas']['SettingsPatch'];
export type ModelName = 'deepseek-chat' | 'deepseek-reasoner';
export type TestModelResult = components['schemas']['TestModelOut'];
export type Profile = components['schemas']['ProfileOut'];

export const settingsApi = {
  get: (): Promise<Settings> => apiRequest<Settings>('/settings', { retries: 0 }),
  patch: (input: SettingsPatch): Promise<Settings> =>
    apiRequest<Settings>('/settings', { method: 'PATCH', body: input, retries: 0 }),
  testModel: (model?: ModelName): Promise<TestModelResult> =>
    apiRequest<TestModelResult>('/settings/test-model', {
      method: 'POST',
      body: { model: model ?? null },
      retries: 0,
      timeoutMs: 60_000,
    }),
  profile: (): Promise<Profile> => apiRequest<Profile>('/profile', { retries: 0 }),
  refreshProfile: (): Promise<components['schemas']['AiTaskOut']> =>
    apiRequest<components['schemas']['AiTaskOut']>('/ai/profile/refresh', {
      method: 'POST',
      retries: 0,
    }),
};

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings.all, queryFn: settingsApi.get, retry: false });
}

export function useProfile() {
  return useQuery({
    queryKey: queryKeys.settings.profile(),
    queryFn: settingsApi.profile,
    retry: false,
  });
}

export function useSettingsMutations() {
  const queryClient = useQueryClient();
  return {
    patch: useMutation({
      mutationFn: (input: SettingsPatch) => settingsApi.patch(input),
      onSuccess: (data) => {
        queryClient.setQueryData(queryKeys.settings.all, data);
      },
    }),
    testModel: useMutation({
      mutationFn: (model?: ModelName) => settingsApi.testModel(model),
    }),
    refreshProfile: useMutation({
      mutationFn: settingsApi.refreshProfile,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.agent.tasksList() });
      },
    }),
  };
}
