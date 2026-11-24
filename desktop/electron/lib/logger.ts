import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** 登记需要在日志中脱敏的字符串（token、密钥等） */
  addSecret(value: string | null | undefined): void;
  filePath: string;
}

export interface LoggerOptions {
  filePath: string;
  minLevel?: LogLevel;
  /** 单文件上限，超过后轮转一次（.1） */
  maxBytes?: number;
  now?: () => Date;
  mirrorToConsole?: boolean;
}

const SECRET_MASK = '***';

/**
 * 结构化 JSON 行日志。
 * 规范要求：不记录 token、API Key、完整用户内容与绝对路径；写入前统一脱敏。
 */
export function createLogger(options: LoggerOptions): Logger {
  const minLevel = options.minLevel ?? 'info';
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const now = options.now ?? (() => new Date());
  const mirrorToConsole = options.mirrorToConsole ?? false;
  const secrets = new Set<string>();
  let dirReady = false;

  const ensureDir = (): void => {
    if (dirReady) {
      return;
    }
    fs.mkdirSync(path.dirname(options.filePath), { recursive: true });
    dirReady = true;
  };

  const redact = (text: string): string => {
    let output = text;
    for (const secret of secrets) {
      if (secret.length >= 6) {
        output = output.split(secret).join(SECRET_MASK);
      }
    }
    return output;
  };

  const rotateIfNeeded = (): void => {
    try {
      const stat = fs.statSync(options.filePath);
      if (stat.size >= maxBytes) {
        fs.renameSync(options.filePath, `${options.filePath}.1`);
      }
    } catch {
      // 文件不存在：无需轮转
    }
  };

  const write = (level: LogLevel, event: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) {
      return;
    }
    const record = {
      ts: now().toISOString(),
      level,
      module: 'desktop-main',
      event,
      ...fields,
    };
    let line: string;
    try {
      line = redact(JSON.stringify(record));
    } catch {
      line = JSON.stringify({ ts: record.ts, level, event, note: 'unserializable_fields' });
    }
    if (mirrorToConsole) {
      // eslint-disable-next-line no-console
      console[level === 'debug' ? 'log' : level](line);
    }
    try {
      ensureDir();
      rotateIfNeeded();
      fs.appendFileSync(options.filePath, `${line}\n`, 'utf8');
    } catch {
      // 日志失败不得影响主流程
    }
  };

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
    addSecret: (value) => {
      if (typeof value === 'string' && value.length > 0) {
        secrets.add(value);
      }
    },
    get filePath() {
      return options.filePath;
    },
  };
}
