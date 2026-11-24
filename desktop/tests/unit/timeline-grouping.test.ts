import { describe, expect, it } from 'vitest';
import type { TimelineGroup, TimelineItem } from '@/api/timeline-types';
import type { components as Components } from '@/api/generated';
import { groupTimelineItems, mergeTimelineGroups, timelineGroupKey, timelineGroupLabel } from '@/features/timeline/grouping';

type GeneratedItem = Components['schemas']['ItemOut'];

function item(id: string, createdAt: string): TimelineItem {
  const base: GeneratedItem = {
    id,
    type: 'note',
    title: `条目 ${id}`,
    content: '正文',
    preview: '正文',
    tags: [],
    file: null,
    status: 'active',
    version: 1,
    embedding_status: 'pending',
    ai_summary: null,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
    idempotent_replay: false,
  };
  return base;
}

describe('timelineGroupKey', () => {
  it('day 按指定时区的墙上 0 点切分', () => {
    const value = '2026-01-01T00:30:00+08:00';
    expect(timelineGroupKey(value, 'day', 'Asia/Shanghai')).toBe('2026-01-01');
    // 同一时刻在 UTC 仍是上一年 12 月 31 日
    expect(timelineGroupKey(value, 'day', 'UTC')).toBe('2025-12-31');
  });

  it('month 同样按时区切分，跨年边界正确', () => {
    expect(timelineGroupKey('2026-01-01T00:30:00+08:00', 'month', 'Asia/Shanghai')).toBe('2026-01');
    expect(timelineGroupKey('2025-12-31T20:00:00Z', 'month', 'Asia/Shanghai')).toBe('2026-01');
  });

  it('week 使用 ISO 8601（跨年周归入下一年的第 1 周）', () => {
    // 2025-12-29 是周一，属于 ISO 2026-W01
    expect(timelineGroupKey('2025-12-29T12:00:00Z', 'week', 'UTC')).toBe('2026-W01');
    expect(timelineGroupKey('2026-01-01T12:00:00Z', 'week', 'UTC')).toBe('2026-W01');
    expect(timelineGroupKey('2026-01-04T12:00:00Z', 'week', 'UTC')).toBe('2026-W01');
    expect(timelineGroupKey('2026-01-05T12:00:00Z', 'week', 'UTC')).toBe('2026-W02');
  });

  it('生成可展示标签', () => {
    expect(timelineGroupLabel('2026-03-05T10:00:00Z', 'day', 'UTC')).toContain('2026年3月5日');
    expect(timelineGroupLabel('2026-03-05T10:00:00Z', 'month', 'UTC')).toBe('2026年3月');
    expect(timelineGroupLabel('2026-03-05T10:00:00Z', 'week', 'UTC')).toContain('2026年第10周');
  });
});

describe('groupTimelineItems', () => {
  it('按分组聚合并按传入顺序保留条目', () => {
    const groups = groupTimelineItems(
      [
        item('a', '2026-01-02T10:00:00Z'),
        item('b', '2026-01-02T09:00:00Z'),
        item('c', '2026-01-01T10:00:00Z'),
      ],
      'day',
      'UTC',
    );
    expect(groups.map((group) => group.key)).toEqual(['2026-01-02', '2026-01-01']);
    expect(groups[0]?.items.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(groups[0]?.item_count).toBe(2);
  });
});

describe('mergeTimelineGroups', () => {
  function group(key: string, ids: string[], count: number): TimelineGroup {
    return {
      key,
      label: `标签-${key}`,
      item_count: count,
      items: ids.map((id) => item(id, '2026-01-02T10:00:00Z')),
    };
  }

  it('同 key 跨页合并：条目去重、item_count 累加', () => {
    const merged = mergeTimelineGroups([
      [group('2026-01-02', ['a', 'b'], 2)],
      [group('2026-01-02', ['b', 'c'], 2)],
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.items.map((entry) => entry.id).sort()).toEqual(['a', 'b', 'c']);
    // 契约 9.2：item_count 是本页计数，跨页累加
    expect(merged[0]?.item_count).toBe(4);
  });

  it('多组按首条目创建时间倒序排列', () => {
    const older: TimelineGroup = {
      key: '2026-01-01',
      label: 'older',
      item_count: 1,
      items: [item('x', '2026-01-01T10:00:00Z')],
    };
    const newer: TimelineGroup = {
      key: '2026-01-05',
      label: 'newer',
      item_count: 1,
      items: [item('y', '2026-01-05T10:00:00Z')],
    };
    const merged = mergeTimelineGroups([[older], [newer]]);
    expect(merged.map((entry) => entry.key)).toEqual(['2026-01-05', '2026-01-01']);
  });

  it('空页面合并为空数组', () => {
    expect(mergeTimelineGroups([])).toEqual([]);
    expect(mergeTimelineGroups([[], []])).toEqual([]);
  });
});

