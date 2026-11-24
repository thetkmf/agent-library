import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ListChecks, RefreshCw, XCircle } from 'lucide-react';
import { userMessageFor } from '@/api/errors';
import {
  useAiSuggestions,
  useAiTasks,
  useCancelAiTask,
  useCreateAiTask,
  useDecideSuggestion,
  type AiTaskInput,
  type Suggestion,
} from '@/api/queries/agent';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonList } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelativeTime } from '@/lib/format';

const TASK_STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
};

const TASK_TYPE_LABEL: Record<string, string> = {
  organize: '整理',
  summarize: '摘要',
  tagging: '打标',
  linking: '关联',
  profile_refresh: '画像刷新',
  graph_build: '图谱构建',
  reindex: '索引重建',
};

const SUGGESTION_TYPE_LABEL: Record<string, string> = {
  tag: '标签建议',
  link: '关联建议',
  summary: '摘要建议',
};

const CREATE_TASKS: Array<{ type: AiTaskInput['type']; label: string; hint: string }> = [
  { type: 'organize', label: '整理知识库', hint: '生成摘要、标签与关联建议' },
  { type: 'summarize', label: '生成摘要', hint: '为条目补充 AI 摘要' },
  { type: 'tagging', label: '智能打标', hint: '建议新标签' },
  { type: 'linking', label: '发现关联', hint: '建议条目间联系' },
  { type: 'profile_refresh', label: '刷新画像', hint: '根据近期内容更新画像' },
];

function suggestionPayloadText(suggestion: Suggestion): string {
  const payload = (suggestion.payload ?? {}) as Record<string, unknown>;
  if (Array.isArray(payload['tags'])) {
    return `建议标签：${(payload['tags'] as unknown[]).join('、')}`;
  }
  if (typeof payload['summary'] === 'string') {
    return `摘要：${payload['summary']}`;
  }
  if (typeof payload['target_item_id'] === 'string') {
    return `关联到 ${String(payload['target_item_id']).slice(0, 8)}… ${String(payload['reason'] ?? '')}`;
  }
  return JSON.stringify(payload).slice(0, 120);
}

/** 任务中心（F7-4/F7-5）：AI 任务列表 + 进度轮询 + 建议采纳/拒绝 */
export function TasksPage(): JSX.Element {
  const tasksQuery = useAiTasks();
  const suggestionsQuery = useAiSuggestions({ status: 'pending' });
  const createTask = useCreateAiTask();
  const cancelTask = useCancelAiTask();
  const decide = useDecideSuggestion();
  const [createError, setCreateError] = useState<string | null>(null);

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const suggestions = useMemo(() => suggestionsQuery.data ?? [], [suggestionsQuery.data]);

  const running = tasks.filter((task) => task.status === 'queued' || task.status === 'running');

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-content">任务中心</h2>
          <span className="text-xs text-muted">
            {running.length} 个进行中 · 共 {tasks.length} 个任务
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void tasksQuery.refetch();
            void suggestionsQuery.refetch();
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          刷新
        </Button>
      </div>

      <section className="rounded-lg border border-border bg-elevated px-3 py-2.5" aria-label="创建任务">
        <p className="text-xs text-muted">创建 AI 任务（需要已配置 DeepSeek 并允许外联）</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CREATE_TASKS.map((task) => (
            <Button
              key={task.type}
              size="sm"
              variant="secondary"
              title={task.hint}
              disabled={createTask.isPending}
              onClick={() => {
                setCreateError(null);
                createTask.mutate(
                  { type: task.type },
                  {
                    onError: (error) => setCreateError(userMessageFor(error)),
                  },
                );
              }}
            >
              {task.label}
            </Button>
          ))}
        </div>
        {createError ? (
          <p className="mt-1.5 text-[11px] text-danger" role="alert">
            {createError}
          </p>
        ) : null}
        {createTask.isSuccess ? (
          <p className="mt-1.5 text-[11px] text-success" role="status">
            任务已提交（{TASK_STATUS_LABEL[createTask.data.status] ?? createTask.data.status}）
          </p>
        ) : null}
      </section>

      {tasksQuery.isPending ? <SkeletonList rows={3} /> : null}

      {tasksQuery.isError ? (
        <ErrorState
          description={userMessageFor(tasksQuery.error)}
          onRetry={() => void tasksQuery.refetch()}
        />
      ) : null}

      {tasksQuery.isSuccess && tasks.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="还没有 AI 任务"
          description="在上方创建整理、摘要或打标任务，进度会自动刷新。"
          className="py-10"
        />
      ) : null}

      {tasks.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="任务列表">
          {tasks.map((task) => {
            const active = task.status === 'queued' || task.status === 'running';
            return (
              <li key={task.id} className="rounded-lg border border-border bg-elevated px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-content">
                    {TASK_TYPE_LABEL[task.type] ?? task.type}
                  </span>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px]',
                      task.status === 'succeeded'
                        ? 'border border-success/30 bg-success/10 text-success'
                        : task.status === 'failed'
                          ? 'border border-danger/30 bg-danger/10 text-danger'
                          : 'border border-accent/30 bg-accent/10 text-accent',
                    )}
                  >
                    {TASK_STATUS_LABEL[task.status] ?? task.status}
                  </span>
                  <span className="text-[11px] text-muted">{task.progress}%</span>
                  <span className="text-[11px] text-muted">
                    创建于 {formatRelativeTime(task.created_at)}
                  </span>
                  {active ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      disabled={cancelTask.isPending}
                      onClick={() => cancelTask.mutate(task.id)}
                    >
                      取消
                    </Button>
                  ) : null}
                </div>
                <div
                  className="mt-1.5 h-1 w-full overflow-hidden rounded bg-sunken"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={task.progress}
                  aria-label={`${TASK_TYPE_LABEL[task.type] ?? task.type} 进度`}
                >
                  <div
                    className={cn(
                      'h-full',
                      task.status === 'failed' ? 'bg-danger' : task.status === 'succeeded' ? 'bg-success' : 'bg-accent',
                    )}
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
                {task.error ? (
                  <p className="mt-1 text-[11px] text-danger">
                    {String((task.error as Record<string, unknown>)['message'] ?? '任务失败')}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <section className="rounded-lg border border-border bg-elevated" aria-label="整理建议">
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-content">待处理建议（{suggestions.length}）</span>
          {decide.isError ? (
            <span className="text-[11px] text-danger" role="alert">
              {userMessageFor(decide.error)}
            </span>
          ) : null}
        </header>

        {suggestionsQuery.isPending ? (
          <div className="p-3">
            <SkeletonList rows={2} />
          </div>
        ) : suggestions.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-muted">暂无待处理建议。</p>
        ) : (
          <ul className="divide-y divide-border">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                  {SUGGESTION_TYPE_LABEL[suggestion.type] ?? suggestion.type}
                </span>
                <Link
                  to={`/notes/${suggestion.item_id}`}
                  className="min-w-0 flex-1 truncate text-xs text-content hover:text-accent hover:underline"
                >
                  {suggestionPayloadText(suggestion)}
                </Link>
                <span className="text-[10px] text-muted">{formatDateTime(suggestion.created_at)}</span>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: suggestion.id, action: 'accept' })}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  采纳
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: suggestion.id, action: 'reject' })}
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  拒绝
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
