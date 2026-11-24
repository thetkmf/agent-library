import { safeStorage } from 'electron';
import type { SecretBox } from './token-store';

/**
 * Electron safeStorage 适配器：Windows 下由 DPAPI 加密，仅当前用户可解密。
 * 规范要求 token 存于凭据管理器；safeStorage 提供等价的系统级加密能力，
 * 差异见《开发过程》决策记录。
 */
export const electronSecretBox: SecretBox = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain: string) => safeStorage.encryptString(plain),
  decrypt: (payload: Buffer) => safeStorage.decryptString(payload),
};
