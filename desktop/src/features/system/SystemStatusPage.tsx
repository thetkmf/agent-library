import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { userMessageFor } from '@/api/errors';
import { queryKeys } from '@/api/keys';
import { useSystemCapabilities, useSystemHealth, useSystemInfo } from '@/api/queries/system';
import { Panel } from '@/components/ui/Panel';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useBootstrapContext } from '@/features/system/bootstrap-context';
import { getBackendStateMeta } from '@/features/system/backend-state';
import { formatBytes, formatDateTime, formatRelativeTime, maskSecret } from '@/lib/format';

interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function DetailRow({ label, value, mono = false }: DetailRowProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1 border-b border-border/60 py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className={`min-w-0 break-all text-xs text-content ${mono ? 'font-mono' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  );
}


interface ApiSelfCheckPanelProps {
  enabled: boolean;
}

/** 接口自检：用真实后端验证 API 客户端（信封解包、错误映射、超时重试） */
function ApiSelfCheckPanel({ enabled }: ApiSelfCheckPanelProps): JSX.Element {
  const queryClient = useQueryClient();
  const health = useSystemHealth({ enabled });
  const info = useSystemInfo({ enabled });
  const capabilities = useSystemCapabilities({ enabled });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.system.all });
  };

  const healthLabel = !enabled
    ? '后端未就绪'
    : health.isPending
      ? '检查中…'
      : health.isError
        ? '不可达'
        : health.data?.status === 'ok'
          ? '正常'
          : '异常';

  return (
    <Panel
      title="接口自检"
      description="通过 /health、/system/info、/system/capabilities 验证契约与客户端行为"
      actions={
        <Button size="sm" onClick={refresh} disabled={!enabled}>
          重新检测
        </Button>
      }
    >
      {!enabled ? (
        <p className="text-xs text-muted">后端就绪后可自动执行接口自检。</p>
      ) : (
        <div className="flex flex-col gap-3">
          {health.isError ? (
            <ErrorState
              title="接口调用失败"
              description={userMessageFor(health.error)}
              onRetry={refresh}
            />
          ) : null}

          <dl className="flex flex-col">
            <DetailRow label="存活检查" value={healthLabel} />
            <DetailRow label="后端版本" value={health.data?.version ?? '—'} mono />
            <DetailRow
              label="契约版本"
              value={info.data ? `${info.data.api_version}（后端 ${info.data.backend_version}）` : '—'}
            />
            <DetailRow label="Python / 平台" value={info.data ? `${info.data.python_version} / ${info.data.platform}` : '—'} mono />
            <DetailRow label="运行环境" value={info.data?.environment ?? '—'} mono />
            <DetailRow
              label="AI（DeepSeek）"
              value={
                capabilities.data
                  ? `${capabilities.data.ai.model} · ${capabilities.data.ai.ready ? '就绪' : '未就绪'}` +
                    ` · Key ${capabilities.data.ai.has_key ? '已配置' : '未配置'}` +
                    ` · 外联 ${capabilities.data.ai.external_calls_enabled ? '已开启' : '未开启'}`
                  : '—'
              }
            />
            <DetailRow
              label="向量索引"
              value={
                capabilities.data
                  ? `${capabilities.data.vector.ready ? '就绪' : '未就绪'} · 已索引 ${capabilities.data.vector.indexed_count} 条`
                  : '—'
              }
            />
            <DetailRow
              label="可用空间"
              value={capabilities.data ? formatBytes(capabilities.data.storage.free_bytes) : '—'}
            />
          </dl>

          <p className="text-[11px] text-muted">
            所有请求均经 `src/api/client.ts`：注入 token 与 `X-Request-Id`、30s 超时、幂等请求最多重试 2 次、信封解包与错误码映射。
          </p>
        </div>
      )}
    </Panel>
  );
}

/** 系统状态页（F0 的诊断能力）：后端进程、token 与运行环境 */
export function SystemStatusPage(): JSX.Element {
  const {
    phase,
    bootstrap,
    backend,
    error,
    bridgeAvailable,
    restarting,
    reload,
    restartBackend,
  } = useBootstrapContext();

  const state = backend?.state ?? 'idle';
  const meta = getBackendStateMeta(state);
  const busy = restarting || state === 'starting';

  return (
    <>
      {!bridgeAvailable ? (
        <div
          className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning"
          role="status"
        >
          当前不在 Electron 容器中运行，IPC 安全桥不可用。请使用 <code>npm run dev</code> 启动桌面端。
        </div>
      ) : null}

      <Panel
        title="本地后端"
        description={meta.hint}
        actions={
          <>
            <Button size="sm" onClick={reload} disabled={!bridgeAvailable}>
              刷新状态
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void restartBackend()}
              disabled={!bridgeAvailable || busy}
            >
              {restarting ? '重启中…' : state === 'starting' ? '启动中…' : '重启后端'}
            </Button>
          </>
        }
      >
        {phase === 'loading' ? <Skeleton lines={4} /> : null}

        {phase === 'error' ? (
          <ErrorState
            description={error ?? '未知错误'}
            onRetry={reload}
            action={
              <Button size="sm" onClick={reload}>
                重新读取
              </Button>
            }
          />
        ) : null}

        {phase === 'ready' && backend && bootstrap ? (
          <div className="flex flex-col gap-3">
            {backend.error_message ? (
              <ErrorState
                title={`后端${meta.label}`}
                description={backend.error_message}
                code={backend.error_code}
                onRetry={bridgeAvailable ? () => void restartBackend() : undefined}
                retryLabel="重启后端"
              />
            ) : null}

            <dl className="flex flex-col">
              <DetailRow label="状态" value={meta.label} />
              <DetailRow label="API 地址" value={backend.api_base_url ?? '未就绪'} mono />
              <DetailRow label="回环端口" value={backend.port ? String(backend.port) : '—'} mono />
              <DetailRow label="进程 PID" value={backend.pid ? String(backend.pid) : '—'} mono />
              <DetailRow label="启动尝试" value={`${backend.attempts} 次`} />
              <DetailRow
                label="状态更新"
                value={`${formatDateTime(backend.updated_at)}（${formatRelativeTime(backend.updated_at)}）`}
              />
              <DetailRow label="数据目录" value={bootstrap.data_dir} mono />
              <DetailRow label="日志文件" value={bootstrap.log_file} mono />
            </dl>
          </div>
        ) : null}

        {state === 'failed' && bootstrap ? (
          <p className="mt-3 rounded bg-sunken px-3 py-2 text-xs text-muted">
            后端未就绪时界面仍可正常打开。请确认后端已实现并能按环境变量契约启动（详见
            <code className="mx-1">desktop/README.md</code>第 4 节）。
          </p>
        ) : null}
      </Panel>

      <ApiSelfCheckPanel enabled={Boolean(backend?.api_base_url)} />

      <Panel title="本地安全上下文" description="token 仅在内存中使用，界面不展示明文">
        {bootstrap ? (
          <dl className="flex flex-col">
            <DetailRow label="本地 token" value={maskSecret(bootstrap.token)} mono />
            <DetailRow
              label="token 存储"
              value={bootstrap.token_secure ? '已加密（safeStorage / DPAPI）' : '降级为明文文件，请检查系统凭据支持'}
            />
            <DetailRow label="Electron" value={bootstrap.electron_version} mono />
            <DetailRow label="平台" value={bootstrap.platform} mono />
            <DetailRow label="运行模式" value={bootstrap.is_dev ? '开发（未打包）' : '生产（已打包）'} />
            <DetailRow label="应用版本" value={bootstrap.app_version} mono />
          </dl>
        ) : (
          <Skeleton lines={3} />
        )}
      </Panel>
    </>
  );
}
