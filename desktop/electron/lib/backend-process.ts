import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { BackendErrorCode, BackendStatus } from '../../shared/ipc';
import { buildApiBaseUrl } from './security-policy';
import { LOOPBACK_HOST, findFreePort } from './ports';
import type { Logger } from './logger';

export type BackendLaunchSource = 'env' | 'packaged' | 'python-module';

export interface BackendLaunch {
  command: string;
  args: string[];
  cwd: string;
  source: BackendLaunchSource;
}

export interface ResolveLaunchOptions {
  isPackaged: boolean;
  resourcesPath: string;
  /** 仓库根目录（开发态用于定位 backend/） */
  projectRoot: string;
  env: NodeJS.ProcessEnv;
  exists?: (candidate: string) => boolean;
}

const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 300;
const DEFAULT_RESTART_DELAY_MS = 1_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const HEALTH_PROBE_TIMEOUT_MS = 1_500;

function defaultExists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

/**
 * 解析后端启动方式，优先级：环境变量覆盖 > 打包产物 > 开发态 Python 模块。
 * 后端未就绪时返回 null，主进程据此给出「后端未安装」的明确状态，而不是反复重启。
 */
export function resolveBackendLaunch(options: ResolveLaunchOptions): BackendLaunch | null {
  const exists = options.exists ?? defaultExists;
  const env = options.env;

  const overrideCommand = env.PKB_BACKEND_CMD?.trim();
  if (overrideCommand) {
    const [command, ...rest] = overrideCommand.split(/\s+/);
    if (!command) {
      return null;
    }
    return {
      command,
      args: rest,
      cwd: env.PKB_BACKEND_CWD?.trim() || options.projectRoot,
      source: 'env',
    };
  }

  if (options.isPackaged) {
    const candidates = [
      path.join(options.resourcesPath, 'backend', 'pkb-backend.exe'),
      path.join(options.resourcesPath, 'backend', 'pkb-backend'),
    ];
    for (const candidate of candidates) {
      if (exists(candidate)) {
        return { command: candidate, args: [], cwd: path.dirname(candidate), source: 'packaged' };
      }
    }
    return null;
  }

  const backendDir = path.join(options.projectRoot, 'backend');
  const entry = path.join(backendDir, 'app', 'main.py');
  if (!exists(entry)) {
    return null;
  }

  const pythonCandidates = [
    env.PKB_PYTHON?.trim(),
    path.join(backendDir, '.venv', 'Scripts', 'python.exe'),
    path.join(backendDir, '.venv', 'bin', 'python'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const python = pythonCandidates.find((candidate) => exists(candidate)) ?? 'python';
  return { command: python, args: ['-m', 'app.main'], cwd: backendDir, source: 'python-module' };
}

export interface BackendSpawnEnvOptions {
  baseEnv: NodeJS.ProcessEnv;
  port: number;
  token: string;
  dataDir: string;
  logFile: string;
  logLevel?: string;
}

/** 后端读取的启动契约（与后端 B0 对齐，见《开发过程》接口变更记录） */
export function buildBackendEnv(options: BackendSpawnEnvOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.baseEnv)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  env.PKB_HOST = LOOPBACK_HOST;
  env.PKB_PORT = String(options.port);
  env.PKB_TOKEN = options.token;
  env.PKB_DATA_DIR = options.dataDir;
  env.PKB_LOG_FILE = options.logFile;
  env.PKB_LOG_LEVEL = options.logLevel ?? 'info';
  return env;
}

export interface BackendManagerDeps {
  findPort: () => Promise<number>;
  probeHealth: (baseUrl: string) => Promise<boolean>;
  spawnProcess: (launch: BackendLaunch, env: Record<string, string>) => ChildProcess;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

export interface BackendManagerOptions {
  launch: BackendLaunch | null;
  token: string;
  dataDir: string;
  logFile: string;
  logger: Logger;
  baseEnv?: NodeJS.ProcessEnv;
  maxAttempts?: number;
  healthTimeoutMs?: number;
  pollIntervalMs?: number;
  restartDelayMs?: number;
  onChange?: (status: BackendStatus) => void;
  deps?: Partial<BackendManagerDeps>;
}

/** 健康检查候选路径：契约见《开发接口标准》9.1（/health 挂在 /api/v1 前缀下） */
export const HEALTH_PATHS = ['/api/v1/health', '/health'] as const;

export async function probeHttpHealth(baseUrl: string): Promise<boolean> {
  for (const healthPath of HEALTH_PATHS) {
    try {
      const response = await fetch(`${baseUrl}${healthPath}`, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // 继续尝试下一个候选路径
    }
  }
  return false;
}

function defaultSpawn(launch: BackendLaunch, env: Record<string, string>): ChildProcess {
  return spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * 后端进程生命周期管理：动态端口 + token 注入 + 健康探测 + 有限次重启。
 * 所有外部副作用通过 deps 注入，便于单元测试。
 */
export class BackendManager {
  private readonly options: BackendManagerOptions;
  private readonly deps: BackendManagerDeps;
  private readonly log: Logger;
  private readonly maxAttempts: number;
  private readonly healthTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly restartDelayMs: number;

  private child: ChildProcess | null = null;
  private stopping = false;
  private running = false;
  private exitedDuringStart = false;
  private lastExitDetail: string | null = null;
  private lastStderrLine: string | null = null;
  private status: BackendStatus;

  constructor(options: BackendManagerOptions) {
    this.options = options;
    this.log = options.logger;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.restartDelayMs = options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS;
    this.deps = {
      findPort: options.deps?.findPort ?? findFreePort,
      probeHealth: options.deps?.probeHealth ?? probeHttpHealth,
      spawnProcess: options.deps?.spawnProcess ?? defaultSpawn,
      sleep: options.deps?.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
      now: options.deps?.now ?? (() => new Date()),
    };
    this.status = {
      state: 'idle',
      pid: null,
      port: null,
      api_base_url: null,
      attempts: 0,
      error_code: null,
      error_message: null,
      updated_at: this.deps.now().toISOString(),
    };
  }

  getStatus(): BackendStatus {
    return { ...this.status };
  }

  async start(): Promise<BackendStatus> {
    if (this.running) {
      return this.getStatus();
    }
    this.running = true;
    this.stopping = false;

    if (!this.options.launch) {
      this.log.warn('backend.launch_unresolved');
      this.running = false;
      return this.update({
        state: 'failed',
        error_code: 'BACKEND_NOT_FOUND',
        error_message: '未找到后端程序，请先完成后端打包或设置 PKB_BACKEND_CMD',
        pid: null,
        port: null,
        api_base_url: null,
      });
    }

    const launch = this.options.launch;
    this.log.info('backend.launch_resolved', {
      source: launch.source,
      command: launch.command,
    });

    let lastErrorCode: BackendErrorCode = 'BACKEND_START_FAILED';
    let lastErrorMessage = '后端启动失败';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (this.stopping) {
        break;
      }
      const result = await this.launchOnce(attempt);
      if (result.ok) {
        this.running = false;
        return this.getStatus();
      }
      lastErrorCode = result.code;
      lastErrorMessage = result.message;

      if (attempt < this.maxAttempts && !this.stopping) {
        this.log.warn('backend.retry_scheduled', { attempt, delay_ms: this.restartDelayMs * attempt });
        await this.deps.sleep(this.restartDelayMs * attempt);
      }
    }

    this.running = false;
    if (this.stopping) {
      return this.getStatus();
    }
    this.log.error('backend.start_failed', { error_code: lastErrorCode, message: lastErrorMessage });
    return this.update({
      state: 'failed',
      error_code: lastErrorCode,
      error_message: lastErrorMessage,
      api_base_url: null,
      port: null,
      pid: null,
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (child) {
      await this.terminate(child);
    }
    this.child = null;
    this.log.info('backend.stopped');
    this.update({
      state: 'stopped',
      pid: null,
      port: null,
      api_base_url: null,
      error_code: null,
      error_message: null,
    });
  }

  async restart(): Promise<BackendStatus> {
    this.log.info('backend.restart_requested');
    await this.stop();
    this.stopping = false;
    this.update({ attempts: 0, error_code: null, error_message: null });
    return this.start();
  }

  private async launchOnce(
    attempt: number,
  ): Promise<{ ok: true } | { ok: false; code: BackendErrorCode; message: string }> {
    const launch = this.options.launch;
    if (!launch) {
      return { ok: false, code: 'BACKEND_NOT_FOUND', message: '未找到后端程序' };
    }

    let port: number;
    try {
      port = await this.deps.findPort();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error('backend.port_alloc_failed', { message });
      return { ok: false, code: 'BACKEND_START_FAILED', message: `端口分配失败：${message}` };
    }

    this.exitedDuringStart = false;
    this.lastExitDetail = null;
    this.lastStderrLine = null;

    const env = buildBackendEnv({
      baseEnv: this.options.baseEnv ?? process.env,
      port,
      token: this.options.token,
      dataDir: this.options.dataDir,
      logFile: this.options.logFile,
    });
    this.log.addSecret(this.options.token);

    this.log.info('backend.spawn', { attempt, port, command: launch.command, cwd: launch.cwd });
    let child: ChildProcess;
    try {
      child = this.deps.spawnProcess(launch, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error('backend.spawn_failed', { message });
      return { ok: false, code: 'BACKEND_START_FAILED', message: `无法启动后端进程：${message}` };
    }

    this.child = child;
    this.attachChild(child);
    this.update({ state: 'starting', attempts: attempt, pid: child.pid ?? null, port });

    const base = `http://${LOOPBACK_HOST}:${port}`;
    const ready = await this.waitForHealth(base);
    if (ready) {
      this.log.info('backend.ready', { port, pid: child.pid ?? null });
      this.update({
        state: 'ready',
        api_base_url: buildApiBaseUrl(port),
        error_code: null,
        error_message: null,
      });
      return { ok: true };
    }

    const wasExpected = this.stopping;
    await this.terminate(child);
    this.child = null;
    if (wasExpected) {
      return { ok: false, code: 'BACKEND_EXITED', message: '后端启动被取消' };
    }

    if (this.exitedDuringStart) {
      const detail = this.lastExitDetail ? `（${this.lastExitDetail}）` : '';
      const reason = this.lastStderrLine ? `：${this.lastStderrLine}` : '';
      return { ok: false, code: 'BACKEND_EXITED', message: `后端进程已退出${detail}${reason}` };
    }
    return {
      ok: false,
      code: 'BACKEND_HEALTH_TIMEOUT',
      message: `后端在 ${Math.round(this.healthTimeoutMs / 1000)} 秒内未通过健康检查`,
    };
  }

  private attachChild(child: ChildProcess): void {
    const streamToLog = (
      stream: NodeJS.ReadableStream | null,
      level: 'info' | 'warn',
      rememberLast = false,
    ): void => {
      if (!stream) {
        return;
      }
      let buffer = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf('\n');
        while (index >= 0) {
          const line = buffer.slice(0, index).trimEnd();
          buffer = buffer.slice(index + 1);
          if (line.length > 0) {
            this.log[level]('backend.output', { line: line.slice(0, 500) });
            if (rememberLast) {
              this.lastStderrLine = line.slice(0, 200);
            }
          }
          index = buffer.indexOf('\n');
        }
      });
    };

    streamToLog(child.stdout, 'info');
    streamToLog(child.stderr, 'warn', true);

    child.on('error', (error) => {
      this.exitedDuringStart = true;
      this.lastExitDetail = error.message;
      this.log.error('backend.process_error', { message: error.message });
    });

    child.on('exit', (code, signal) => {
      this.lastExitDetail = `code=${code ?? 'null'} signal=${signal ?? 'null'}`;
      this.log.warn('backend.process_exit', { code, signal });
      if (this.child === child) {
        this.child = null;
      }
      if (this.stopping) {
        return;
      }
      this.exitedDuringStart = true;
      // 已就绪后进程意外退出：直接标记失败，由用户或上层决定是否重启
      if (this.status.state === 'ready') {
        this.update({
          state: 'failed',
          error_code: 'BACKEND_EXITED',
          error_message: '后端进程意外退出，可点击「重启后端」重试',
          pid: null,
          api_base_url: null,
        });
      }
    });
  }

  private async waitForHealth(baseUrl: string): Promise<boolean> {
    const deadline = this.deps.now().getTime() + this.healthTimeoutMs;
    for (;;) {
      if (this.exitedDuringStart || this.stopping) {
        return false;
      }
      if (await this.deps.probeHealth(baseUrl)) {
        return true;
      }
      if (this.deps.now().getTime() >= deadline) {
        return false;
      }
      await this.deps.sleep(this.pollIntervalMs);
    }
  }

  private async terminate(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
    const deadline = this.deps.now().getTime() + 3_000;
    while (child.exitCode === null && child.signalCode === null) {
      if (this.deps.now().getTime() >= deadline) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        return;
      }
      await this.deps.sleep(100);
    }
  }

  private update(patch: Partial<BackendStatus>): BackendStatus {
    this.status = {
      ...this.status,
      ...patch,
      updated_at: this.deps.now().toISOString(),
    };
    try {
      this.options.onChange?.(this.getStatus());
    } catch (error) {
      this.log.error('backend.on_change_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return this.getStatus();
  }
}
