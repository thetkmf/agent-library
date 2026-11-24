import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Save, Sparkles } from 'lucide-react';
import { userMessageFor } from '@/api/errors';
import {
  useProfile,
  useSettings,
  useSettingsMutations,
  type ModelName,
} from '@/api/queries/settings';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Panel } from '@/components/ui/Panel';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatBytes, formatDateTime } from '@/lib/format';

const MODEL_OPTIONS: Array<{ value: ModelName; label: string }> = [
  { value: 'deepseek-chat', label: 'deepseek-chat（默认，对话与工具）' },
  { value: 'deepseek-reasoner', label: 'deepseek-reasoner（推理与总结）' },
];

/** 设置与画像（F11）：DeepSeek 唯一供应商、Key 只写不回显、外联显式同意 */
export function SettingsPage(): JSX.Element {
  const settingsQuery = useSettings();
  const profileQuery = useProfile();
  const mutations = useSettingsMutations();

  const [modelName, setModelName] = useState<ModelName>('deepseek-chat');
  const [apiKey, setApiKey] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const settings = settingsQuery.data;

  useEffect(() => {
    if (!settings) {
      return;
    }
    setModelName((settings.model.name as ModelName) ?? 'deepseek-chat');
    setTheme((settings.ui.theme as 'light' | 'dark' | 'system') ?? 'system');
  }, [settings]);

  const allowedExtensions = useMemo(
    () => settings?.storage.allowed_extensions ?? [],
    [settings],
  );

  const saveModel = (): void => {
    setNotice(null);
    setActionError(null);
    mutations.patch.mutate(
      {
        model: {
          provider: 'deepseek',
          name: modelName,
          ...(apiKey.trim().length > 0 ? { api_key: apiKey.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          setApiKey('');
          setNotice('模型设置已保存；密钥仅写入不读回。');
        },
        onError: (error) => setActionError(userMessageFor(error)),
      },
    );
  };

  const toggleExternalCalls = (next: boolean): void => {
    if (
      next &&
      !window.confirm('开启后对话与自动化会把必要内容发送到 DeepSeek 云端接口，确定开启？')
    ) {
      return;
    }
    setNotice(null);
    mutations.patch.mutate(
      { privacy: { allow_external_calls: next } },
      {
        onSuccess: () => setNotice(next ? '已开启对外调用' : '已关闭对外调用'),
        onError: (error) => setActionError(userMessageFor(error)),
      },
    );
  };

  const toggleAutoOrganize = (next: boolean): void => {
    mutations.patch.mutate(
      { ai: { auto_organize_enabled: next } },
      { onError: (error) => setActionError(userMessageFor(error)) },
    );
  };

  const saveTheme = (next: 'light' | 'dark' | 'system'): void => {
    setTheme(next);
    mutations.patch.mutate({ ui: { theme: next } });
  };

  const testModel = (): void => {
    setNotice(null);
    setActionError(null);
    mutations.testModel.mutate(modelName, {
      onSuccess: (result) => setNotice(`连通成功：${result.model}，延迟 ${result.latency_ms} ms`),
      onError: (error) => setActionError(userMessageFor(error)),
    });
  };

  if (settingsQuery.isPending) {
    return <Skeleton lines={8} />;
  }

  if (settingsQuery.isError || !settings) {
    return (
      <ErrorState
        description={userMessageFor(settingsQuery.error)}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  return (
    <>
      {notice ? (
        <div className="rounded border border-success/40 bg-success/10 px-3 py-2 text-xs text-success" role="status">
          {notice}
        </div>
      ) : null}
      {actionError ? (
        <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger" role="alert">
          {actionError}
        </div>
      ) : null}

      <Panel title="模型（DeepSeek）" description="供应商固定为 DeepSeek；密钥只写入，不回显">
        <div className="flex flex-col gap-3">
          <dl className="flex flex-col gap-1 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">供应商</dt>
              <dd className="font-mono text-content">{settings.model.provider}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">接口地址</dt>
              <dd className="font-mono text-content">{settings.model.base_url}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">密钥</dt>
              <dd className={settings.model.has_key ? 'text-success' : 'text-warning'}>
                {settings.model.has_key ? '已配置' : '未配置'}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs text-muted">
              默认模型
              <select
                aria-label="默认模型"
                value={modelName}
                onChange={(event) => setModelName(event.target.value as ModelName)}
                className="rounded border border-border bg-elevated px-2 py-1.5 text-sm text-content"
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs text-muted">
              API Key（只写回显）
              <input
                type="password"
                aria-label="DeepSeek API Key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={settings.model.has_key ? '已配置；留空表示不修改' : '填入 DeepSeek API Key'}
                autoComplete="off"
                className="rounded border border-border bg-elevated px-2 py-1.5 text-sm text-content outline-none focus:border-accent"
              />
            </label>
            <Button size="sm" variant="primary" onClick={saveModel} disabled={mutations.patch.isPending}>
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              保存
            </Button>
            <Button size="sm" variant="secondary" onClick={testModel} disabled={mutations.testModel.isPending}>
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              {mutations.testModel.isPending ? '测试中…' : '测试连通性'}
            </Button>
          </div>
          <p className="text-[11px] text-muted">
            密钥存于 Windows 凭据管理器；接口只返回 `has_key`，不返回明文。
          </p>
        </div>
      </Panel>

      <Panel title="隐私与自动化" description="默认不外联；开启后 AI 功能才可用">
        <div className="flex flex-col gap-2 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="允许对外调用"
              checked={settings.privacy.allow_external_calls}
              onChange={(event) => toggleExternalCalls(event.target.checked)}
              className="h-3.5 w-3.5 accent-[rgb(var(--pkb-accent))]"
            />
            <span className="text-content">允许调用 DeepSeek 云端接口</span>
            <span className="text-muted">
              （仅发送当前任务所需片段与对话，不上传整库）
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="自动整理"
              checked={settings.ai.auto_organize_enabled}
              onChange={(event) => toggleAutoOrganize(event.target.checked)}
              className="h-3.5 w-3.5 accent-[rgb(var(--pkb-accent))]"
            />
            <span className="text-content">自动整理新内容（生成摘要/标签建议）</span>
          </label>
          <label className="flex items-center gap-2 text-muted">
            主题
            <select
              aria-label="主题"
              value={theme}
              onChange={(event) => saveTheme(event.target.value as 'light' | 'dark' | 'system')}
              className="rounded border border-border bg-elevated px-1.5 py-1 text-xs text-content"
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
        </div>
      </Panel>

      <Panel title="存储" description="路径由主进程管理，不暴露绝对文件路径">
        <dl className="flex flex-col gap-1 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">数据目录</dt>
            <dd className="break-all font-mono text-content">{settings.storage.data_dir}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">小文件上限</dt>
            <dd className="text-content">{formatBytes(settings.storage.max_small_file_bytes)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">单文件上限</dt>
            <dd className="text-content">{formatBytes(settings.storage.max_file_bytes)}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted">允许的扩展名</dt>
            <dd className="flex flex-wrap gap-1">
              {allowedExtensions.map((extension) => (
                <span key={extension} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                  {extension}
                </span>
              ))}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">嵌入模型</dt>
            <dd className="text-content">
              {settings.embedding.model}（{settings.embedding.dimension} 维 · {settings.embedding.status}）
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel
        title="用户画像"
        description="由 AI 任务生成；仅本机保存"
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              mutations.refreshProfile.mutate(undefined, {
                onSuccess: () => setNotice('已提交画像刷新任务，可在任务中心查看进度'),
                onError: (error) => setActionError(userMessageFor(error)),
              })
            }
            disabled={mutations.refreshProfile.isPending}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            刷新画像
          </Button>
        }
      >
        {profileQuery.isPending ? (
          <Skeleton lines={3} />
        ) : profileQuery.isError ? (
          <ErrorState
            description={userMessageFor(profileQuery.error)}
            onRetry={() => void profileQuery.refetch()}
          />
        ) : (
          <div className="flex flex-col gap-2 text-xs">
            <div>
              <p className="text-muted">兴趣</p>
              <p className="text-content">
                {(profileQuery.data?.interests ?? []).length > 0
                  ? (profileQuery.data?.interests ?? []).join('、')
                  : '暂无'}
              </p>
            </div>
            <div>
              <p className="text-muted">知识领域</p>
              <ul className="flex flex-wrap gap-1">
                {(profileQuery.data?.knowledge_domains ?? []).map((domain, index) => (
                  <li key={index} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                    {String((domain as Record<string, unknown>)['name'] ?? '领域')}
                    {typeof (domain as Record<string, unknown>)['level'] === 'number'
                      ? ` · L${String((domain as Record<string, unknown>)['level'])}`
                      : ''}
                  </li>
                ))}
                {(profileQuery.data?.knowledge_domains ?? []).length === 0 ? (
                  <li className="text-muted">暂无</li>
                ) : null}
              </ul>
            </div>
            <div>
              <p className="text-muted">学习目标</p>
              <p className="text-content">
                {(profileQuery.data?.learning_goals ?? []).length > 0
                  ? (profileQuery.data?.learning_goals ?? []).join('、')
                  : '暂无'}
              </p>
            </div>
            <p className="text-muted">
              偏好：{profileQuery.data?.preferred_style ?? '未设置'} · 更新于{' '}
              {formatDateTime(profileQuery.data?.updated_at)}
            </p>
          </div>
        )}
      </Panel>
    </>
  );
}
