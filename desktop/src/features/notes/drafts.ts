/**
 * 本地草稿：按条目 id 保存，含基线版本，用于崩溃/刷新/冲突后恢复。
 * 只存草稿正文，不存 token 等敏感信息。
 */
export interface ItemDraft {
  content: string;
  /** 草稿基于的服务端版本，用于判断能否直接覆盖 */
  baseVersion: number;
  savedAt: string;
}

const KEY_PREFIX = 'pkb.draft.item.';

function keyOf(itemId: string): string {
  return `${KEY_PREFIX}${itemId}`;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function saveDraft(itemId: string, draft: ItemDraft): void {
  const target = storage();
  if (!target) {
    return;
  }
  try {
    target.setItem(keyOf(itemId), JSON.stringify(draft));
  } catch {
    // 配额不足时放弃草稿，不阻塞保存主流程
  }
}

export function loadDraft(itemId: string): ItemDraft | null {
  const target = storage();
  if (!target) {
    return null;
  }
  try {
    const raw = target.getItem(keyOf(itemId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as ItemDraft;
    if (typeof parsed.content !== 'string' || typeof parsed.baseVersion !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(itemId: string): void {
  const target = storage();
  try {
    target?.removeItem(keyOf(itemId));
  } catch {
    // ignore
  }
}
