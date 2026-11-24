import path from 'node:path';

export interface AppPaths {
  userDataDir: string;
  logsDir: string;
  dataDir: string;
  tokenFile: string;
  logFile: string;
}

export interface CreateAppPathsOptions {
  userDataDir: string;
  /** 允许通过环境变量覆盖数据目录（开发/测试用） */
  dataDirOverride?: string | undefined;
  now?: () => Date;
}

function formatDay(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function createAppPaths(options: CreateAppPathsOptions): AppPaths {
  const now = options.now ?? (() => new Date());
  const logsDir = path.join(options.userDataDir, 'logs');
  const dataDir = options.dataDirOverride
    ? path.resolve(options.dataDirOverride)
    : path.join(options.userDataDir, 'data');
  return {
    userDataDir: options.userDataDir,
    logsDir,
    dataDir,
    tokenFile: path.join(options.userDataDir, 'local-token.json'),
    logFile: path.join(logsDir, `desktop-${formatDay(now())}.log`),
  };
}
