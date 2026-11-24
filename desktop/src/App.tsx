import { useTheme, type ThemeMode } from '@/features/theme/useTheme';
import { useBootstrap } from '@/features/system/useBootstrap';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getBackendStateMeta } from '@/features/system/backend-state';
import { formatDateTime, formatRelativeTime, maskSecret } from '@/lib/format';

const THEME_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function DetailRow({ label, value, mono = false }: DetailRowProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1 border-b border-border/60 py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd
        className={`min-w-0 break-all text-xs text-content ${mono ? 'font-mono' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

export function App(): JSX.Element {
  const { mode, setMode } = useTheme();
  const {
    phase,
    bootstrap,
    backend,
    error,
    bridgeAvailable,
    restarting,
    reload,
    restartBackend,
  } = useBootstrap();

  const state = backend?.state ?? 'idle';
  const meta = getBackendStateMeta(state);
  const busy = restarting || state === 'starting';

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-elevated px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded bg-accent/10 text-sm font-semibold text-accent">
            知
          </span>
          <div>
            <h1 className="text-sm font-semibold text-content">个人专属智能知识库</h1>
            <p className="text-xs text-muted">
              本地私有化 · API v1
              {bootstrap ? ` · 应用版本 ${bootstrap.app_version}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge state={state} />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMode(mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark')}
            title={`主题：${THEME_LABEL[mode]}`}
          >
            主题：{THEME_LABEL[mode]}
          </Button>
        </div>
      </header>

      <main className="pkb-scrollbar flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
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
                  {busy ? '重启中…' : '重启后端'}
                </Button>
              </>
            }
          >
            {phase === 'loading' ? (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="h-4 w-2/3 animate-pulse rounded bg-sunken" />
                ))}
              </div>
            ) : null}

            {phase === 'error' ? (
              <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                读取启动信息失败：{error ?? '未知错误'}
              </div>
            ) : null}

            {phase === 'ready' && backend && bootstrap ? (
              <div className="flex flex-col gap-3">
                {backend.error_message ? (
                  <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                    {backend.error_message}
                    {backend.error_code ? <span className="ml-2 text-danger/70">({backend.error_code})</span> : null}
                  </div>
                ) : null}

                <dl className="flex flex-col">
                  <DetailRow label="状态" value={meta.label} />
                  <DetailRow label="API 地址" value={bootstrap.api_base_url ?? '未就绪'} mono />
                  <DetailRow label="回环端口" value={backend.port ? String(backend.port) : '—'} mono />
                  <DetailRow label="进程 PID" value={backend.pid ? String(backend.pid) : '—'} mono />
                  <DetailRow label="启动尝试" value={`${backend.attempts} 次`} />
                  <DetailRow label="状态更新" value={`${formatDateTime(backend.updated_at)}（${formatRelativeTime(backend.updated_at)}）`} />
                  <DetailRow label="数据目录" value={bootstrap.data_dir} mono />
                  <DetailRow label="日志文件" value={bootstrap.log_file} mono />
                </dl>
              </div>
            ) : null}

            {state === 'failed' && bootstrap ? (
              <p className="mt-3 rounded bg-sunken px-3 py-2 text-xs text-muted">
                后端尚未就绪时，界面仍可正常打开。待后端工作树完成 B0（工程骨架 + <code>/health</code>）后，
                桌面端会自动接管进程启动。
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
                <DetailRow label="运行模式" value={bootstrap.is_dev ? '开发（dev server）' : '生产（打包）'} />
              </dl>
            ) : (
              <div className="h-4 w-1/2 animate-pulse rounded bg-sunken" aria-busy="true" />
            )}
          </Panel>
        </div>
      </main>

      <footer className="flex items-center justify-between border-t border-border bg-elevated px-6 py-2 text-xs text-muted">
        <span>里程碑 M0 · 骨架就绪</span>
        <span>F0 前端骨架</span>
      </footer>
    </div>
  );
}
