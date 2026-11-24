/**
 * 检索页 URL 状态（F6-1）：q / mode / type / tag_id 与 URL 双向同步。
 * 非法值在这里收敛为可展示错误，页面据此进入错误态而不发请求。
 */
import type { ItemType } from '@/api/queries/items';
import {
  SEARCH_QUERY_MAX,
  isSearchableQuery,
  type SearchMode,
} from '@/api/queries/search';

export const SEARCH_MODES: readonly SearchMode[] = ['keyword', 'semantic', 'hybrid'];
export const SEARCH_TYPES: readonly ItemType[] = ['note', 'tex', 'file'];
export const DEFAULT_SEARCH_MODE: SearchMode = 'hybrid';

export interface SearchUrlState {
  q: string;
  mode: SearchMode;
  types: ItemType[];
  tagIds: string[];
}

export interface ParsedSearchState {
  state: SearchUrlState;
  errors: string[];
}

export function parseSearchState(searchParams: URLSearchParams): ParsedSearchState {
  const errors: string[] = [];

  const q = searchParams.get('q') ?? '';
  if (q.trim().length > SEARCH_QUERY_MAX) {
    errors.push(`关键字不能超过 ${SEARCH_QUERY_MAX} 个字符`);
  }

  const rawMode = searchParams.get('mode');
  let mode: SearchMode = DEFAULT_SEARCH_MODE;
  if (rawMode) {
    if ((SEARCH_MODES as readonly string[]).includes(rawMode)) {
      mode = rawMode as SearchMode;
    } else {
      errors.push(`不支持的检索模式：${rawMode}`);
    }
  }

  const types: ItemType[] = [];
  for (const raw of searchParams.getAll('type')) {
    for (const value of raw.split(',')) {
      const candidate = value.trim();
      if (candidate.length === 0) {
        continue;
      }
      if (!(SEARCH_TYPES as readonly string[]).includes(candidate)) {
        errors.push(`不支持的条目类型：${candidate}`);
        continue;
      }
      if (!types.includes(candidate as ItemType)) {
        types.push(candidate as ItemType);
      }
    }
  }

  const tagIds = searchParams
    .getAll('tag_id')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return { state: { q, mode, types, tagIds }, errors };
}

/** 只写非默认值，保证 URL 简洁且可被前进/后退还原 */
export function searchStateToParams(state: SearchUrlState): URLSearchParams {
  const params = new URLSearchParams();
  const q = state.q.trim();
  if (q.length > 0) {
    params.set('q', q);
  }
  if (state.mode !== DEFAULT_SEARCH_MODE) {
    params.set('mode', state.mode);
  }
  for (const type of state.types) {
    params.append('type', type);
  }
  for (const tagId of state.tagIds) {
    params.append('tag_id', tagId);
  }
  return params;
}

/** 是否可以发起检索（供页面 enabled 判断） */
export function canSearch(state: SearchUrlState, errors: readonly string[] = []): boolean {
  return errors.length === 0 && isSearchableQuery(state.q);
}
