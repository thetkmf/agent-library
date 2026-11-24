import { useMemo, useState } from 'react';
import { GraduationCap, Plus } from 'lucide-react';
import { userMessageFor } from '@/api/errors';
import {
  useLearningMutations,
  useLearningPlans,
  useLearningProgress,
  type LearningPlan,
  type Milestone,
  type MilestoneStatus,
  type PlanStatus,
} from '@/api/queries/learning';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Panel } from '@/components/ui/Panel';
import { SkeletonList } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/format';

const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  planning: '规划中',
  active: '进行中',
  done: '已完成',
  archived: '已归档',
};

const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  todo: '待开始',
  in_progress: '进行中',
  done: '已完成',
};

function MilestoneRow({ milestone, onChange, onRemove }: {
  milestone: Milestone;
  onChange: (status: MilestoneStatus, progress: number) => void;
  onRemove: () => void;
}): JSX.Element {
  const status = milestone.status as MilestoneStatus;
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-xs text-content">{milestone.title}</span>
      <span className="text-[10px] text-muted">{milestone.due_date ?? '无截止日期'}</span>
      <select
        aria-label={`${milestone.title} 状态`}
        value={status}
        onChange={(event) => onChange(event.target.value as MilestoneStatus, milestone.progress)}
        className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px] text-content"
      >
        {(Object.keys(MILESTONE_STATUS_LABEL) as MilestoneStatus[]).map((value) => (
          <option key={value} value={value}>
            {MILESTONE_STATUS_LABEL[value]}
          </option>
        ))}
      </select>
      <span className="text-[11px] text-muted">{milestone.progress}%</span>
      <Button size="sm" variant="ghost" onClick={onRemove}>
        删除
      </Button>
    </li>
  );
}

/** 学习计划与进度（F9）：进度汇总 + 计划看板 + 里程碑 */
export function LearningPage(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<'all' | PlanStatus>('all');
  const plansQuery = useLearningPlans(statusFilter === 'all' ? {} : { status: statusFilter });
  const progressQuery = useLearningProgress();
  const mutations = useLearningMutations();

  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [milestoneTitle, setMilestoneTitle] = useState('');

  const plans = useMemo(() => plansQuery.data ?? [], [plansQuery.data]);
  const progress = progressQuery.data;

  const createPlan = (): void => {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setFormError('计划标题不能为空');
      return;
    }
    setFormError(null);
    mutations.create.mutate(
      { title: trimmed, goal: goal.trim() || null, status: 'active' },
      {
        onSuccess: (plan) => {
          setTitle('');
          setGoal('');
          setSelectedId(plan.id);
        },
        onError: (error) => setFormError(userMessageFor(error)),
      },
    );
  };

  const addMilestone = (plan: LearningPlan): void => {
    const trimmed = milestoneTitle.trim();
    if (trimmed.length === 0) {
      return;
    }
    mutations.addMilestone.mutate(
      { planId: plan.id, input: { title: trimmed } },
      { onSuccess: () => setMilestoneTitle('') },
    );
  };

  return (
    <>
      <section className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="学习进度汇总">
        {[
          { label: '总计划', value: progress?.total_plans ?? 0 },
          { label: '进行中', value: progress?.active_plans ?? 0 },
          {
            label: '完成率',
            // 契约 9.8：completion_rate 为 0–1 的比例
            value: `${Math.round((progress?.completion_rate ?? 0) * 100)}%`,
          },
          { label: '连续学习', value: `${progress?.streak_days ?? 0} 天` },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-border bg-elevated px-3 py-2">
            <p className="text-[11px] text-muted">{card.label}</p>
            <p className="text-lg font-semibold text-content">{card.value}</p>
          </div>
        ))}
      </section>

      <Panel title="新建学习计划" description="进度以后端统计为准（里程碑完成情况驱动）">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-muted">
              标题
              <input
                aria-label="计划标题"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                className="rounded border border-border bg-elevated px-2 py-1.5 text-sm text-content outline-none focus:border-accent"
              />
            </label>
            <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs text-muted">
              目标（可选）
              <input
                aria-label="学习目标"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                className="rounded border border-border bg-elevated px-2 py-1.5 text-sm text-content outline-none focus:border-accent"
              />
            </label>
            <Button size="sm" variant="primary" onClick={createPlan} disabled={mutations.create.isPending} data-testid="create-plan">
              创建计划
            </Button>
          </div>
          {formError ? (
            <p className="text-xs text-danger" role="alert">
              {formError}
            </p>
          ) : null}
        </div>
      </Panel>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-content">计划看板</h2>
          <span className="text-xs text-muted">{plans.length} 个</span>
        </div>
        <select
          aria-label="按状态筛选计划"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as 'all' | PlanStatus)}
          className="rounded border border-border bg-elevated px-2 py-1 text-xs text-content"
        >
          <option value="all">全部状态</option>
          {(Object.keys(PLAN_STATUS_LABEL) as PlanStatus[]).map((value) => (
            <option key={value} value={value}>
              {PLAN_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </div>

      {plansQuery.isPending ? <SkeletonList rows={2} /> : null}
      {plansQuery.isError ? (
        <ErrorState
          description={userMessageFor(plansQuery.error)}
          onRetry={() => void plansQuery.refetch()}
        />
      ) : null}

      {plansQuery.isSuccess && plans.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="还没有学习计划"
          description="创建一个计划并添加里程碑，进度会自动统计。"
          className="py-10"
        />
      ) : null}

      <ul className="flex flex-col gap-2">
        {plans.map((plan) => (
          <li key={plan.id} className="rounded-lg border border-border bg-elevated">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <button
                type="button"
                aria-expanded={plan.id === selectedId}
                onClick={() => setSelectedId(plan.id === selectedId ? null : plan.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="text-sm font-medium text-content">{plan.title}</span>
                <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                  {PLAN_STATUS_LABEL[plan.status as PlanStatus] ?? plan.status}
                </span>
                {plan.goal ? <span className="ml-2 text-[11px] text-muted">{plan.goal}</span> : null}
              </button>
              <span className="text-[11px] text-muted">
                {plan.milestones?.length ?? 0} 个里程碑 · {formatRelativeTime(plan.updated_at)}
              </span>
              <select
                aria-label={`${plan.title} 状态`}
                value={plan.status}
                onChange={(event) =>
                  mutations.update.mutate({
                    id: plan.id,
                    input: {
                      expected_version: plan.version,
                      status: event.target.value as PlanStatus,
                    },
                  })
                }
                className="rounded border border-border bg-elevated px-1 py-0.5 text-[11px] text-content"
              >
                {(Object.keys(PLAN_STATUS_LABEL) as PlanStatus[]).map((value) => (
                  <option key={value} value={value}>
                    {PLAN_STATUS_LABEL[value]}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => mutations.remove.mutate(plan.id)}
                disabled={mutations.remove.isPending}
              >
                删除
              </Button>
            </div>

            {plan.id === selectedId ? (
              <div className="border-t border-border px-3 py-2">
                <ul>
                  {(plan.milestones ?? []).map((milestone) => (
                    <MilestoneRow
                      key={milestone.id}
                      milestone={milestone}
                      onChange={(status, current) =>
                        mutations.updateMilestone.mutate({
                          id: milestone.id,
                          input: { status, progress: status === 'done' ? 100 : current },
                        })
                      }
                      onRemove={() => mutations.removeMilestone.mutate(milestone.id)}
                    />
                  ))}
                </ul>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    aria-label="里程碑标题"
                    value={milestoneTitle}
                    onChange={(event) => setMilestoneTitle(event.target.value)}
                    placeholder="新增里程碑"
                    className="flex-1 rounded border border-border bg-elevated px-2 py-1 text-xs text-content outline-none focus:border-accent"
                  />
                  <Button size="sm" variant="secondary" onClick={() => addMilestone(plan)}>
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    添加
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {mutations.update.isError || mutations.updateMilestone.isError || mutations.addMilestone.isError ? (
        <ErrorState
          description={userMessageFor(
            mutations.update.error ?? mutations.updateMilestone.error ?? mutations.addMilestone.error,
          )}
          onRetry={() => void plansQuery.refetch()}
          retryLabel="刷新"
        />
      ) : null}

      <p className={cn('text-[11px]', progressQuery.isError ? 'text-danger' : 'text-muted')}>
        完成率与连续学习天数由后端 `/learning/progress` 计算；里程碑勾选为「已完成」时进度置 100%。
      </p>
    </>
  );
}
