import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TokenStore, generateToken, TOKEN_BYTES, type SecretBox } from '../../electron/lib/token-store';

const reversibleBox: SecretBox = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decrypt: (payload) => payload.toString('utf8').replace(/^enc:/, ''),
};

const unavailableBox: SecretBox = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error('unavailable');
  },
  decrypt: () => {
    throw new Error('unavailable');
  },
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkb-token-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('generateToken', () => {
  it('生成 32 字节随机十六进制串', () => {
    const token = generateToken();
    expect(token).toHaveLength(TOKEN_BYTES * 2);
    expect(token).toMatch(/^[0-9a-f]+$/);
    expect(generateToken()).not.toBe(token);
  });
});

describe('TokenStore', () => {
  it('首次调用签发并落盘，二次调用复用', () => {
    const store = new TokenStore({
      filePath: path.join(dir, 'token.json'),
      box: reversibleBox,
      now: () => new Date('2026-11-24T00:00:00Z'),
    });

    const first = store.ensure();
    expect(first.secure).toBe(true);
    expect(first.token).toHaveLength(TOKEN_BYTES * 2);

    const raw = fs.readFileSync(path.join(dir, 'token.json'), 'utf8');
    expect(raw).not.toContain(first.token);

    const second = store.ensure();
    expect(second.token).toBe(first.token);
  });

  it('rotate 丢弃旧 token 并签发新的', () => {
    const store = new TokenStore({ filePath: path.join(dir, 'token.json'), box: reversibleBox });
    const first = store.ensure();
    const rotated = store.rotate();
    expect(rotated.token).not.toBe(first.token);
    expect(store.load()?.token).toBe(rotated.token);
  });

  it('无法加密时降级为明文并标记 secure=false', () => {
    const store = new TokenStore({ filePath: path.join(dir, 'token.json'), box: unavailableBox });
    const stored = store.ensure();
    expect(stored.secure).toBe(false);
    expect(store.load()?.token).toBe(stored.token);
  });

  it('文件损坏时视为不存在', () => {
    const filePath = path.join(dir, 'token.json');
    fs.writeFileSync(filePath, 'not-json', 'utf8');
    const store = new TokenStore({ filePath, box: reversibleBox });
    expect(store.load()).toBeNull();
  });

  it('加密文件在无法解密的环境下重新签发', () => {
    const filePath = path.join(dir, 'token.json');
    new TokenStore({ filePath, box: reversibleBox }).ensure();
    const store = new TokenStore({ filePath, box: unavailableBox });
    expect(store.load()).toBeNull();
    const reissued = store.ensure();
    expect(reissued.secure).toBe(false);
  });
});
