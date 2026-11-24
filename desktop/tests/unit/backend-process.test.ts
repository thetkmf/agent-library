import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import {
  BackendManager,
  buildBackendEnv,
  resolveBackendLaunch,
  type BackendLaunch,
} from '../../electron/lib/backend-process';
import { createLogger } from '../../electron/lib/logger';

interface FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: (signal?: NodeJS.Signals | number) => boolean;
}

function createFakeChild(pid = 4242): FakeChild {
  const child = new EventEmitter() as unknown as FakeChild;
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal?: NodeJS.Signals | number) => {
    if (child.exitCode !== null) {
      return false;
    }
    child.exitCode = 0;
    child.signalCode = typeof signal === 'string' ? signal : null;
    setImmediate(() => child.emit('exit', 0, signal ?? null));
    return true;
  };
  return child;
}

let dir: string;
let logFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkb-backend-'));
  logFile = path.join(dir, 'desktop.log');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function createLoggerForTest() {
  return createLogger({ filePath: logFile, minLevel: 'debug', mirrorToConsole: false });
}

describe('resolveBackendLaunch', () => {
  const base = {
    isPackaged: false,
    resourcesPath: 'C:/Program Files/PKB/resources',
    projectRoot: 'C:/repo',
    env: {} as NodeJS.ProcessEnv,
  };

  it('优先使用 PKB_BACKEND_CMD 覆盖', () => {
    const launch = resolveBackendLaunch({
      ...base,
      env: { PKB_BACKEND_CMD: 'C:/py/python.exe -m app.main', PKB_BACKEND_CWD: 'C:/repo/backend' },
    });
    expect(launch).toEqual({
      command: 'C:/py/python.exe',
      args: ['-m', 'app.main'],
      cwd: 'C:/repo/backend',
      source: 'env',
    });
  });

  it('开发态定位 backend/app/main.py 并使用模块启动', () => {
    const exists = (candidate: string): boolean => candidate.endsWith(path.join('app', 'main.py'));
    const launch = resolveBackendLaunch({ ...base, exists });
    expect(launch?.source).toBe('python-module');
    expect(launch?.args).toEqual(['-m', 'app.main']);
    expect(launch?.cwd).toBe(path.join('C:/repo', 'backend'));
  });

  it('后端尚未实现时返回 null', () => {
    expect(resolveBackendLaunch({ ...base, exists: () => false })).toBeNull();
  });

  it('打包态优先使用 resources/backend 可执行文件', () => {
    const exists = (candidate: string): boolean => candidate.endsWith('pkb-backend.exe');
    const launch = resolveBackendLaunch({ ...base, isPackaged: true, exists });
    expect(launch?.source).toBe('packaged');
    expect(launch?.command).toContain('pkb-backend.exe');
  });
});

describe('buildBackendEnv', () => {
  it('注入端口、token 与数据目录契约', () => {
    const env = buildBackendEnv({
      baseEnv: { PATH: 'C:/Windows', PKB_TOKEN: 'should-be-overridden' },
      port: 52341,
      token: 'local-token',
      dataDir: 'C:/data',
      logFile: 'C:/logs/desktop.log',
    });
    expect(env['PKB_HOST']).toBe('127.0.0.1');
    expect(env['PKB_PORT']).toBe('52341');
    expect(env['PKB_TOKEN']).toBe('local-token');
    expect(env['PKB_DATA_DIR']).toBe('C:/data');
    expect(env['PKB_LOG_FILE']).toBe('C:/logs/desktop.log');
    expect(env['PATH']).toBe('C:/Windows');
  });
});

describe('BackendManager', () => {
  const launch: BackendLaunch = {
    command: 'python',
    args: ['-m', 'app.main'],
    cwd: 'C:/repo/backend',
    source: 'python-module',
  };

  function createManager(overrides: {
    probeHealth?: () => Promise<boolean>;
    spawnProcess?: () => FakeChild;
    attempts?: number;
    healthTimeoutMs?: number;
  } = {}) {
    const child = overrides.spawnProcess?.() ?? createFakeChild();
    const manager = new BackendManager({
      launch,
      token: 'local-token',
      dataDir: dir,
      logFile,
      logger: createLoggerForTest(),
      baseEnv: {},
      maxAttempts: overrides.attempts ?? 3,
      healthTimeoutMs: overrides.healthTimeoutMs ?? 1_000,
      pollIntervalMs: 1,
      restartDelayMs: 1,
      deps: {
        findPort: () => Promise.resolve(52341),
        probeHealth: overrides.probeHealth ?? (() => Promise.resolve(true)),
        spawnProcess: () => child as unknown as ChildProcess,
        sleep: () => Promise.resolve(),
        now: vi.fn(() => new Date()),
      },
    });
    return { manager, child };
  }

  it('健康检查通过后进入 ready 并暴露 API 基地址', async () => {
    const { manager } = createManager();
    const status = await manager.start();
    expect(status.state).toBe('ready');
    expect(status.api_base_url).toBe('http://127.0.0.1:52341/api/v1');
    expect(status.port).toBe(52341);
    expect(status.pid).toBe(4242);
    expect(status.error_code).toBeNull();
  });

  it('未找到后端程序时给出 BACKEND_NOT_FOUND', async () => {
    const manager = new BackendManager({
      launch: null,
      token: 't',
      dataDir: dir,
      logFile,
      logger: createLoggerForTest(),
    });
    const status = await manager.start();
    expect(status.state).toBe('failed');
    expect(status.error_code).toBe('BACKEND_NOT_FOUND');
  });

  it('健康检查超时后按次数重试，最终失败', async () => {
    let spawnCount = 0;
    let clock = 0;
    const manager = new BackendManager({
      launch,
      token: 'local-token',
      dataDir: dir,
      logFile,
      logger: createLoggerForTest(),
      baseEnv: {},
      maxAttempts: 3,
      healthTimeoutMs: 2_000,
      pollIntervalMs: 1,
      restartDelayMs: 1,
      deps: {
        findPort: () => Promise.resolve(52341),
        probeHealth: () => Promise.resolve(false),
        spawnProcess: () => {
          spawnCount += 1;
          return createFakeChild(5000 + spawnCount) as unknown as ChildProcess;
        },
        sleep: () => Promise.resolve(),
        now: () => {
          clock += 1_000;
          return new Date(clock);
        },
      },
    });

    const status = await manager.start();
    expect(spawnCount).toBe(3);
    expect(status.state).toBe('failed');
    expect(status.error_code).toBe('BACKEND_HEALTH_TIMEOUT');
    expect(status.attempts).toBe(3);
    expect(status.port).toBeNull();
  });

  it('就绪后进程意外退出会标记 BACKEND_EXITED，并可重启', async () => {
    const { manager, child } = createManager();
    await manager.start();
    expect(manager.getStatus().state).toBe('ready');

    child.exitCode = 1;
    child.emit('exit', 1, null);

    const failed = manager.getStatus();
    expect(failed.state).toBe('failed');
    expect(failed.error_code).toBe('BACKEND_EXITED');
    expect(failed.api_base_url).toBeNull();

    const restartChild = createFakeChild(7777);
    const restarted = new BackendManager({
      launch,
      token: 'local-token',
      dataDir: dir,
      logFile,
      logger: createLoggerForTest(),
      baseEnv: {},
      deps: {
        findPort: () => Promise.resolve(52342),
        probeHealth: () => Promise.resolve(true),
        spawnProcess: () => restartChild as unknown as ChildProcess,
        sleep: () => Promise.resolve(),
        now: () => new Date(),
      },
    });
    const status = await restarted.start();
    expect(status.state).toBe('ready');
    expect(status.port).toBe(52342);
  });

  it('stop 后状态为 stopped 且 API 地址清空', async () => {
    const { manager } = createManager();
    await manager.start();
    await manager.stop();
    const status = manager.getStatus();
    expect(status.state).toBe('stopped');
    expect(status.api_base_url).toBeNull();
    expect(status.pid).toBeNull();
  });

  it('状态变化会通知订阅者', async () => {
    const changes: string[] = [];
    const manager = new BackendManager({
      launch,
      token: 'local-token',
      dataDir: dir,
      logFile,
      logger: createLoggerForTest(),
      baseEnv: {},
      onChange: (status) => changes.push(status.state),
      deps: {
        findPort: () => Promise.resolve(52341),
        probeHealth: () => Promise.resolve(true),
        spawnProcess: () => createFakeChild() as unknown as ChildProcess,
        sleep: () => Promise.resolve(),
        now: () => new Date(),
      },
    });

    await manager.start();
    expect(changes).toEqual(['starting', 'ready']);
  });
});
