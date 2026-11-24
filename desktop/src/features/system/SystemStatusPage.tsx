import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useBootstrapContext } from '@/features/system/bootstrap-context';
import { getBackendStateMeta } from '@/features/system/backend-state';
import { formatDateTime, formatRelativeTime, maskSecret } from '@/lib/format';

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
              <DetailRow label="API 地址" value={bootstrap.api_base_url ?? '未就绪'} mono />
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
