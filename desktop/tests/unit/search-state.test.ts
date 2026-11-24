import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_MODE,
  SEARCH_MODES,
  canSearch,
  parseSearchState,
  searchStateToParams,
  type SearchUrlState,
} from '@/features/search/search-state';
import { SEARCH_QUERY_MAX, isSearchableQuery } from '@/api/queries/search';

describe('parseSearchState', () => {
  it('解析 q / mode / type / tag_id', () => {
    const { state, errors } = parseSearchState(
      new URLSearchParams('q=向量检索&mode=semantic&type=note,tex&tag_id=t1&tag_id=t2'),
    );
    expect(errors).toEqual([]);
    expect(state).toEqual({
      q: '向量检索',
      mode: 'semantic',
      types: ['note', 'tex'],
      tagIds: ['t1', 't2'],
    });
  });

  it('缺省为混合模式且无筛选', () => {
    const { state } = parseSearchState(new URLSearchParams());
    expect(state.mode).toBe(DEFAULT_SEARCH_MODE);
    expect(state.types).toEqual([]);
    expect(state.tagIds).toEqual([]);
  });

  it('非法模式与类型进入错误收集', () => {
    const { errors } = parseSearchState(new URLSearchParams('mode=fuzzy&type=doc'));
    expect(errors).toContain('不支持的检索模式：fuzzy');
    expect(errors).toContain('不支持的条目类型：doc');
  });

  it('超长关键字报错', () => {
    const { errors } = parseSearchState(new URLSearchParams(`q=${'a'.repeat(SEARCH_QUERY_MAX + 1)}`));
    expect(errors).toHaveLength(1);
  });
});

describe('searchStateToParams', () => {
  it('只写非默认值并能被 parse 还原', () => {
    const state: SearchUrlState = {
      q: ' 向量 ',
      mode: 'keyword',
      types: ['file'],
      tagIds: ['t1'],
    };
    const params = searchStateToParams(state);
    expect(params.get('q')).toBe('向量');
    expect(params.get('mode')).toBe('keyword');
    expect(params.getAll('type')).toEqual(['file']);
    expect(params.getAll('tag_id')).toEqual(['t1']);

    const parsed = parseSearchState(params);
    expect(parsed.errors).toEqual([]);
    expect(parsed.state).toEqual({ q: '向量', mode: 'keyword', types: ['file'], tagIds: ['t1'] });
  });

  it('默认状态生成空参数', () => {
    expect(
      searchStateToParams({ q: '', mode: DEFAULT_SEARCH_MODE, types: [], tagIds: [] }).toString(),
    ).toBe('');
  });
});

describe('canSearch / isSearchableQuery', () => {
  it('trim 后 1–200 字符才可检索', () => {
    expect(isSearchableQuery('a')).toBe(true);
    expect(isSearchableQuery('  ')).toBe(false);
    expect(isSearchableQuery('a'.repeat(SEARCH_QUERY_MAX))).toBe(true);
    expect(isSearchableQuery('a'.repeat(SEARCH_QUERY_MAX + 1))).toBe(false);
  });

  it('存在 URL 错误时不发起检索', () => {
    expect(canSearch({ q: '向量', mode: 'hybrid', types: [], tagIds: [] }, [])).toBe(true);
    expect(canSearch({ q: '向量', mode: 'hybrid', types: [], tagIds: [] }, ['错误'])).toBe(false);
  });
});

describe('SEARCH_MODES', () => {
  it('与契约一致', () => {
    expect([...SEARCH_MODES]).toEqual(['keyword', 'semantic', 'hybrid']);
  });
});
