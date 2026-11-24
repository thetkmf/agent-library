import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface SecretBox {
  /** 当前环境是否可加密（Windows 下由 DPAPI 支撑） */
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(payload: Buffer): string;
}

export interface StoredToken {
  token: string;
  /** true = safeStorage 加密落盘；false = 明文落盘（降级模式） */
  secure: boolean;
  created_at: string;
}

interface TokenFilePayload {
  version: 1;
  secure: boolean;
  created_at: string;
  /** secure=true 时是 base64 密文，否则是明文 token */
  value: string;
}

export interface TokenStoreOptions {
  filePath: string;
  box: SecretBox;
  now?: () => Date;
}

export const TOKEN_BYTES = 32;

export function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * 本地一次性 token 的生成与持久化。
 * 优先使用 safeStorage（Windows DPAPI）；不可用时降级为仅当前用户可读的明文文件并记录告警。
 */
export class TokenStore {
  private readonly filePath: string;
  private readonly box: SecretBox;
  private readonly now: () => Date;

  constructor(options: TokenStoreOptions) {
    this.filePath = options.filePath;
    this.box = options.box;
    this.now = options.now ?? (() => new Date());
  }

  get secure(): boolean {
    return this.box.isAvailable();
  }

  load(): StoredToken | null {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch {
      return null;
    }

    try {
      const payload = JSON.parse(raw) as TokenFilePayload;
      if (payload.version !== 1 || typeof payload.value !== 'string') {
        return null;
      }
      if (!payload.secure) {
        return payload.value.length > 0
          ? { token: payload.value, secure: false, created_at: payload.created_at }
          : null;
      }
      if (!this.box.isAvailable()) {
        // 加密文件但当前系统无法解密（换了用户/凭据库不可用）：视为不存在，重新签发
        return null;
      }
      const decrypted = this.box.decrypt(Buffer.from(payload.value, 'base64'));
      return decrypted.length > 0
        ? { token: decrypted, secure: true, created_at: payload.created_at }
        : null;
    } catch {
      return null;
    }
  }

  /** 读取现有 token，不存在则新建并落盘 */
  ensure(): StoredToken {
    const existing = this.load();
    if (existing) {
      return existing;
    }
    const token = generateToken();
    const secure = this.box.isAvailable();
    const payload: TokenFilePayload = {
      version: 1,
      secure,
      created_at: this.now().toISOString(),
      value: secure
        ? this.box.encrypt(token).toString('base64')
        : token,
    };
    this.write(payload);
    return { token, secure, created_at: payload.created_at };
  }

  /** 丢弃旧 token 并重新签发（token 失效时使用） */
  rotate(): StoredToken {
    this.remove();
    return this.ensure();
  }

  remove(): void {
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch {
      // 删除失败不影响主流程，下次启动会重新签发
    }
  }

  private write(payload: TokenFilePayload): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    try {
      // Windows 下 mode 不可靠，尽量收紧 ACL 依赖系统默认用户目录权限
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // ignore
    }
  }
}
