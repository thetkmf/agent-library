import { describe, expect, it } from 'vitest';
import {
  buildTimelineRequest,
  filtersToSearchParams,
  localDateEndIso,
  localDateStartIso,
  parseTimelineFilters,
  DEFAULT_TIMELINE_FILTERS,
} from '@/features/timeline/filters';

const TAG_ID = '0199b100-0000-7000-8000-000000000001';

describe('parseTimelineFilters', () => {
  it('解析全部筛选参数并归一化', () => {
    const params = new URLSearchParams({
      type: 'note,tex',
      status: 'archived',
      group_by: 'week',
      tag_id: TAG_ID,
      q: '  向量  ',
      created_from: '2026-01-01',
      created_to: '2026-01-31',
    });
    const { filters, errors } = parseTimelineFilters(params);

    expect(errors).toEqual([]);
    expect(filters).toEqual({
      groupBy: 'week',
      types: ['note', 'tex'],
      status: 'archived',
      tagId: TAG_ID,
      q: '向量',
      createdFrom: '2026-01-01',
      createdTo: '2026-01-31',
    });
  });

  it('空参数返回默认筛选', () => {
    const { filters, errors } = parseTimelineFilters(new URLSearchParams());
    expect(errors).toEqual([]);
    expect(filters).toEqual(DEFAULT_TIMELINE_FILTERS);
  });

  it('非法枚举与日期进入错误收集，不阻断开其余字段', () => {
    const params = new URLSearchParams({
      type: 'doc',
      status: 'deleted',
      group_by: 'year',
      tag_id: 'not-a-uuid',
      created_from: '2026-13-01',
      created_to: '2026-02-30',
    });
    const { filters, errors } = parseTimelineFilters(params);
    expect(errors).toHaveLength(6);
    expect(filters.types).toEqual([]);
    expect(filters.status).toBe('active');
    expect(filters.groupBy).toBe('day');
    expect(filters.tagId).toBe('not-a-uuid');
  });

  it('开始日期晚于结束日期报错', () => {
    const { errors } = parseTimelineFilters(
      new URLSearchParams({ created_from: '2026-02-01', created_to: '2026-01-01' }),
    );
    expect(errors).toContain('开始日期不能晚于结束日期');
  });

  it('type 重复去重', () => {
    const { filters } = parseTimelineFilters(new URLSearchParams('type=note&type=note'));
    expect(filters.types).toEqual(['note']);
  });
});

describe('filtersToSearchParams', () => {
  it('只写非默认值，并能被 parse 还原', () => {
    const filters = {
      ...DEFAULT_TIMELINE_FILTERS,
      groupBy: 'month' as const,
      types: ['tex' as const],
      status: 'trashed' as const,
      tagId: TAG_ID,
      q: '公式',
      createdFrom: '2026-01-01',
      createdTo: '2026-01-02',
    };
    const params = filtersToSearchParams(filters);
    expect(params.getAll('type')).toEqual(['tex']);
    expect(params.get('group_by')).toBe('month');
    expect(params.get('status')).toBe('trashed');
    expect(params.get('tag_id')).toBe(TAG_ID);
    expect(params.get('q')).toBe('公式');

    const parsed = parseTimelineFilters(params);
    expect(parsed.errors).toEqual([]);
    expect(parsed.filters).toEqual(filters);
  });

  it('默认筛选生成空参数', () => {
    expect(filtersToSearchParams(DEFAULT_TIMELINE_FILTERS).toString()).toBe('');
  });
});

describe('时区与请求构造', () => {
  it('本地日期转换为指定时区的 UTC 边界', () => {
    // Asia/Shanghai 为 UTC+8：本地 00:00 → 前一天 16:00Z
    expect(localDateStartIso('2026-01-01', 'Asia/Shanghai')).toBe('2025-12-31T16:00:00.000Z');
    expect(localDateEndIso('2026-01-01', 'Asia/Shanghai')).toBe('2026-01-01T15:59:59.999Z');
  });

  it('buildTimelineRequest 携带筛选参数与 limit', () => {
    const request = buildTimelineRequest(
      {
        ...DEFAULT_TIMELINE_FILTERS,
        types: ['note'],
        tagId: TAG_ID,
        q: '检索',
        createdFrom: '2026-01-01',
      },
      { timeZone: 'Asia/Shanghai', limit: 20 },
    );

    expect(request).toEqual({
      group_by: 'day',
      tz: 'Asia/Shanghai',
      from: '2025-12-31T16:00:00.000Z',
      to: undefined,
      type: ['note'],
      status: undefined,
      tag_id: TAG_ID,
      q: '检索',
      limit: 20,
    });
  });

  it('非默认状态会带上 status', () => {
    const request = buildTimelineRequest(
      { ...DEFAULT_TIMELINE_FILTERS, status: 'archived' },
      { timeZone: 'UTC' },
    );
    expect(request.status).toBe('archived');
  });

  it('非法时区抛错（对应契约 40002）', () => {
    expect(() => buildTimelineRequest(DEFAULT_TIMELINE_FILTERS, { timeZone: 'Mars/Base' })).toThrow();
  });
});
