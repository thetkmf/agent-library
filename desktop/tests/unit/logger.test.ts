import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../electron/lib/logger';
import { createAppPaths } from '../../electron/lib/paths';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkb-logger-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('createLogger', () => {
  it('写入结构化 JSON 行并脱敏已登记的密钥', () => {
    const filePath = path.join(dir, 'logs', 'desktop.log');
    const logger = createLogger({ filePath, minLevel: 'debug', mirrorToConsole: false });
    logger.addSecret('super-secret-token');

    logger.info('backend.spawn', { port: 12345, token: 'super-secret-token' });

    const line = fs.readFileSync(filePath, 'utf8').trim();
    expect(line).not.toContain('super-secret-token');
    expect(line).toContain('***');
    const record = JSON.parse(line) as Record<string, unknown>;
    expect(record['event']).toBe('backend.spawn');
    expect(record['level']).toBe('info');
    expect(record['port']).toBe(12345);
    expect(typeof record['ts']).toBe('string');
  });

  it('按级别过滤日志', () => {
    const filePath = path.join(dir, 'desktop.log');
    const logger = createLogger({ filePath, minLevel: 'warn', mirrorToConsole: false });
    logger.debug('debug.event');
    logger.info('info.event');
    logger.warn('warn.event');

    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('warn.event');
  });

  it('日志目录自动创建，写入失败不影响调用方', () => {
    const filePath = path.join(dir, 'nested', 'deep', 'desktop.log');
    const logger = createLogger({ filePath, mirrorToConsole: false });
    expect(() => logger.info('app.starting')).not.toThrow();
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe('createAppPaths', () => {
  it('按 userData 派生日志与数据目录', () => {
    const paths = createAppPaths({
      userDataDir: 'C:/Users/tester/AppData/Roaming/PersonalKnowledgeBase',
      now: () => new Date('2026-11-24T03:00:00Z'),
    });
    expect(paths.dataDir).toContain('data');
    expect(paths.tokenFile.endsWith('local-token.json')).toBe(true);
    expect(path.basename(paths.logFile)).toBe('desktop-20261124.log');
    expect(paths.logsDir).toContain('logs');
  });

  it('支持环境变量覆盖数据目录', () => {
    const paths = createAppPaths({
      userDataDir: 'C:/tmp/ud',
      dataDirOverride: 'D:/pkb-data',
    });
    expect(path.resolve(paths.dataDir)).toBe(path.resolve('D:/pkb-data'));
  });
});
