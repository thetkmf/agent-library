// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppBootstrap, BackendStatus, PkbBridge } from '@shared/ipc';
import { useBootstrap } from '@/features/system/useBootstrap';

function bootstrapPayload(apiBaseUrl: string | null, status: BackendStatus): AppBootstrap {
  return {
    app_version: '0.1.0',
    electron_version: '33.0.0',
    platform: 'win32',
    is_dev: true,
    token: 'tok',
    token_secure: true,
    api_base_url: apiBaseUrl,
    backend: status,
    data_dir: 'C:/data',
    log_file: 'C:/logs/d.log',
  };
}

function backendStatus(state: BackendStatus['state'], apiBaseUrl: string | null): BackendStatus {
  return {
    state,
    pid: state === 'ready' ? 123 : null,
    port: apiBaseUrl ? 5000 : null,
    api_base_url: apiBaseUrl,
    attempts: 1,
    error_code: null,
    error_message: null,
    updated_at: '2026-11-24T00:00:00Z',
  };
}

function Probe(): JSX.Element {
  const { bootstrap, backend, phase } = useBootstrap();
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <span data-testid="boot-url">{bootstrap?.api_base_url ?? 'null'}</span>
      <span data-testid="state">{backend?.state ?? 'none'}</span>
    </div>
  );
}

let emitStatus: ((status: BackendStatus) => void) | null = null;

function installBridge(payload: AppBootstrap): void {
  const bridge: PkbBridge = {
    channels: [],
    getBootstrap: async () => payload,
    getAppInfo: async () => ({
      app_version: '0.1.0',
      electron_version: '33.0.0',
      platform: 'win32',
      is_dev: true,
      data_dir: 'C:/data',
      log_file: 'C:/logs/d.log',
    }),
    restartBackend: async () => backendStatus('starting', null),
    openExternal: async () => true,
    onBackendStatus: (listener) => {
      emitStatus = listener;
      return () => {
        emitStatus = null;
      };
    },
  };
  Object.defineProperty(window, 'pkb', { value: bridge, configurable: true });
}

afterEach(() => {
  emitStatus = null;
  Reflect.deleteProperty(window, 'pkb');
});

describe('useBootstrap', () => {
  it('后端后启动时把 api_base_url 同步回启动上下文', async () => {
    installBridge(bootstrapPayload(null, backendStatus('starting', null)));
    render(<Probe />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('phase')).toHaveTextContent('ready');
    expect(screen.getByTestId('boot-url')).toHaveTextContent('null');

    await act(async () => {
      emitStatus?.(backendStatus('ready', 'http://127.0.0.1:5000/api/v1'));
    });

    expect(screen.getByTestId('state')).toHaveTextContent('ready');
    expect(screen.getByTestId('boot-url')).toHaveTextContent('http://127.0.0.1:5000/api/v1');
  });

  it('无 IPC 桥时进入离线态但不报错', async () => {
    render(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('phase')).toHaveTextContent('ready');
    expect(screen.getByTestId('state')).toHaveTextContent('failed');
  });
});
