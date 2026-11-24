// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from '@/features/notes/drafts';

beforeEach(() => {
  window.localStorage.clear();
});

describe('草稿存储', () => {
  it('保存后可读取并清除', () => {
    saveDraft('item-1', { content: '草稿正文', baseVersion: 3, savedAt: '2026-11-24T00:00:00Z' });
    expect(loadDraft('item-1')).toEqual({
      content: '草稿正文',
      baseVersion: 3,
      savedAt: '2026-11-24T00:00:00Z',
    });

    clearDraft('item-1');
    expect(loadDraft('item-1')).toBeNull();
  });

  it('结构非法时视为无草稿', () => {
    window.localStorage.setItem('pkb.draft.item.bad', '{"content":1}');
    expect(loadDraft('bad')).toBeNull();
  });

  it('损坏的 JSON 不抛异常', () => {
    window.localStorage.setItem('pkb.draft.item.broken', 'not-json');
    expect(loadDraft('broken')).toBeNull();
  });
});
