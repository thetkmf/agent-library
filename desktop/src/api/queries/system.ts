import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { components } from '@/api/generated';
import { queryKeys } from '@/api/keys';

export type HealthData = components['schemas']['HealthOut'];
export type SystemInfo = components['schemas']['SystemInfoOut'];
export type Capabilities = components['schemas']['CapabilitiesOut'];

export interface QueryToggle {
  enabled?: boolean;
}

/** 系统接口封装：路径与参数集中在此，页面不感知 URL */
export const systemApi = {
  health: () => apiRequest<HealthData>('/health', { expect: 'raw', retries: 0 }),
  info: () => apiRequest<SystemInfo>('/system/info'),
  capabilities: () => apiRequest<Capabilities>('/system/capabilities'),
};

export function useSystemHealth({ enabled = true }: QueryToggle = {}) {
  return useQuery({
    queryKey: queryKeys.system.health(),
    queryFn: systemApi.health,
    enabled,
    retry: false,
    refetchInterval: enabled ? 15_000 : false,
    staleTime: 5_000,
  });
}

export function useSystemInfo({ enabled = true }: QueryToggle = {}) {
  return useQuery({
    queryKey: queryKeys.system.info(),
    queryFn: systemApi.info,
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export function useSystemCapabilities({ enabled = true }: QueryToggle = {}) {
  return useQuery({
    queryKey: queryKeys.system.capabilities(),
    queryFn: systemApi.capabilities,
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}
