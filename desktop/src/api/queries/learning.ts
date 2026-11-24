import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { queryKeys } from '@/api/keys';
import type { components } from '@/api/generated';

/** 学习计划与进度（契约 9.8）。B10 已合入。 */
export type LearningPlan = components['schemas']['PlanOut'];
export type Milestone = components['schemas']['MilestoneOut'];
export type LearningProgress = components['schemas']['ProgressOut'];
export type PlanStatus = 'planning' | 'active' | 'done' | 'archived';
export type MilestoneStatus = 'todo' | 'in_progress' | 'done';

export interface PlanCreateInput {
  title: string;
  goal?: string | null;
  start_date?: string | null;
  target_date?: string | null;
  status?: PlanStatus;
  milestones?: Array<{ title: string; due_date?: string | null }>;
}

export const learningApi = {
  plans: async (query: { status?: string } = {}): Promise<LearningPlan[]> => {
    const page = await apiRequest<components['schemas']['PlanPage']>('/learning/plans', {
      query: { page_size: 50, status: query.status },
      retries: 0,
    });
    return page.items ?? [];
  },
  plan: (id: string): Promise<LearningPlan> =>
    apiRequest<LearningPlan>(`/learning/plans/${encodeURIComponent(id)}`, { retries: 0 }),
  create: (input: PlanCreateInput): Promise<LearningPlan> =>
    apiRequest<LearningPlan>('/learning/plans', { method: 'POST', body: input, retries: 0 }),
  update: (
    id: string,
    input: { expected_version: number; title?: string; status?: PlanStatus },
  ): Promise<LearningPlan> =>
    apiRequest<LearningPlan>(`/learning/plans/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      retries: 0,
    }),
  remove: (id: string): Promise<{ id: string }> =>
    apiRequest<{ id: string }>(`/learning/plans/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      retries: 0,
    }),
  addMilestone: (
    planId: string,
    input: { title: string; due_date?: string | null; status?: MilestoneStatus; progress?: number },
  ): Promise<Milestone> =>
    apiRequest<Milestone>(`/learning/plans/${encodeURIComponent(planId)}/milestones`, {
      method: 'POST',
      body: input,
      retries: 0,
    }),
  updateMilestone: (
    id: string,
    input: { status?: MilestoneStatus; progress?: number; title?: string },
  ): Promise<Milestone> =>
    apiRequest<Milestone>(`/learning/milestones/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
      retries: 0,
    }),
  removeMilestone: (id: string): Promise<{ id: string }> =>
    apiRequest<{ id: string }>(`/learning/milestones/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      retries: 0,
    }),
  progress: (): Promise<LearningProgress> =>
    apiRequest<LearningProgress>('/learning/progress', { retries: 0 }),
};

export function useLearningPlans(query: { status?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.learning.plans(query),
    queryFn: () => learningApi.plans(query),
    retry: false,
    staleTime: 10_000,
  });
}

export function useLearningProgress() {
  return useQuery({
    queryKey: queryKeys.learning.progress(),
    queryFn: learningApi.progress,
    retry: false,
    staleTime: 10_000,
  });
}

export function useLearningMutations() {
  const queryClient = useQueryClient();
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.learning.all });
  };
  return {
    create: useMutation({ mutationFn: (input: PlanCreateInput) => learningApi.create(input), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: { expected_version: number; title?: string; status?: PlanStatus } }) =>
        learningApi.update(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: learningApi.remove, onSuccess: invalidate }),
    addMilestone: useMutation({
      mutationFn: ({ planId, input }: { planId: string; input: { title: string; due_date?: string | null } }) =>
        learningApi.addMilestone(planId, input),
      onSuccess: invalidate,
    }),
    updateMilestone: useMutation({
      mutationFn: ({ id, input }: { id: string; input: { status?: MilestoneStatus; progress?: number } }) =>
        learningApi.updateMilestone(id, input),
      onSuccess: invalidate,
    }),
    removeMilestone: useMutation({ mutationFn: learningApi.removeMilestone, onSuccess: invalidate }),
  };
}
