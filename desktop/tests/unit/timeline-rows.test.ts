import { describe, expect, it } from 'vitest';
import type { TimelineGroup, TimelineItem } from '@/api/timeline-types';
import type { components as Components } from '@/api/generated';
import {
  TIMELINE_HEADER_HEIGHT,
  TIMELINE_ITEM_HEIGHT,
  findFirstVisibleIndex,
  findLastVisibleIndex,
  findRowIndexAt,
  flattenTimelineGroups,
  measureRows,
} from '@/features/timeline/rows';
import { computeWindow } from '@/features/timeline/useVirtualWindow';

type GeneratedItem = Components['schemas']['ItemOut'];

function item(id: string): TimelineItem {
  const base: GeneratedItem = {
    id,
    type: 'note',
    title: `条目 ${id}`,
    content: '',
    preview: '',
    tags: [],
    file: null,
    status: 'active',
    version: 1,
    embedding_status: 'pending',
    ai_summary: null,
    created_at: '2026-01-02T10:00:00Z',
    updated_at: '2026-01-02T10:00:00Z',
    deleted_at: null,
    idempotent_replay: false,
  };
  return base;
}

function group(key: string, count: number): TimelineGroup {
  return {
    key,
    label: `分组 ${key}`,
    item_count: count,
    items: Array.from({ length: count }, (_, index) => item(`${key}-${index}`)),
  };
}

function bigGroups(groups: number, perGroup: number): TimelineGroup[] {
  return Array.from({ length: groups }, (_, index) => group(`g${index}`, perGroup));
}

describe('flattenTimelineGroups', () => {
  it('每组先插入分组行，再插入条目行', () => {
    const rows = flattenTimelineGroups([group('a', 2), group('b', 1)]);
    expect(rows.map((row) => row.kind)).toEqual(['group', 'item', 'item', 'group', 'item']);
    expect(rows[0]).toMatchObject({ key: 'a', count: 2 });
  });

  it('空分组被跳过', () => {
    const rows = flattenTimelineGroups([{ key: 'empty', label: '空', item_count: 0, items: [] }, group('b', 1)]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'group', key: 'b' });
  });
});

describe('measureRows / 行定位', () => {
  it('行高按分组/条目区分并累计', () => {
    const { positions, totalHeight } = measureRows(flattenTimelineGroups([group('a', 2)]));
    expect(positions.map((position) => position.height)).toEqual([
      TIMELINE_HEADER_HEIGHT,
      TIMELINE_ITEM_HEIGHT,
      TIMELINE_ITEM_HEIGHT,
    ]);
    expect(totalHeight).toBe(TIMELINE_HEADER_HEIGHT + TIMELINE_ITEM_HEIGHT * 2);
    expect(positions[1]?.top).toBe(TIMELINE_HEADER_HEIGHT);
  });

  it('findRowIndexAt 命中行内任意位置', () => {
    const { positions } = measureRows(flattenTimelineGroups([group('a', 2)]));
    expect(findRowIndexAt(positions, 0)).toBe(0);
    expect(findRowIndexAt(positions, TIMELINE_HEADER_HEIGHT - 1)).toBe(0);
    expect(findRowIndexAt(positions, TIMELINE_HEADER_HEIGHT)).toBe(1);
    expect(findRowIndexAt(positions, 10_000)).toBe(positions.length - 1);
    expect(findRowIndexAt(positions, -1)).toBe(-1);
    expect(findRowIndexAt([], 10)).toBe(-1);
  });

  it('可见区间首尾索引', () => {
    const { positions } = measureRows(flattenTimelineGroups([group('a', 5)]));
    expect(findFirstVisibleIndex(positions, 0)).toBe(0);
    expect(findFirstVisibleIndex(positions, TIMELINE_HEADER_HEIGHT + TIMELINE_ITEM_HEIGHT * 2)).toBe(3);
    expect(findLastVisibleIndex(positions, 1)).toBe(0);
    expect(findLastVisibleIndex(positions, TIMELINE_HEADER_HEIGHT * 2)).toBe(1);
  });
});

describe('computeWindow（虚拟滚动）', () => {
  it('只渲染可见区间并带 overscan', () => {
    const rows = flattenTimelineGroups(bigGroups(2, 10));
    const { positions } = measureRows(rows);
    const window = computeWindow(positions, 0, 300, 2);
    expect(window.startIndex).toBe(0);
    // 300px 约覆盖 3 条（含分组行），加上 2 条 overscan
    expect(window.endIndex).toBeGreaterThanOrEqual(3);
    expect(window.endIndex).toBeLessThan(8);
  });

  it('滚动到中部时窗口随之移动', () => {
    const rows = flattenTimelineGroups(bigGroups(2, 10));
    const { positions, totalHeight } = measureRows(rows);
    const window = computeWindow(positions, Math.floor(totalHeight / 2), 300, 0);
    expect(window.startIndex).toBeGreaterThan(0);
    expect(window.endIndex).toBeLessThan(positions.length - 1);
  });

  it('一万条数据下窗口很小且索引合法', () => {
    const rows = flattenTimelineGroups(bigGroups(100, 100));
    const { positions, totalHeight } = measureRows(rows);
    expect(rows).toHaveLength(100 * 101);

    const window = computeWindow(positions, Math.floor(totalHeight * 0.6), 800, 4);
    expect(window.endIndex - window.startIndex).toBeLessThan(20);
    expect(positions[window.startIndex]).toBeDefined();
    expect(positions[window.endIndex]).toBeDefined();
  });

  it('空列表返回空窗口', () => {
    expect(computeWindow([], 0, 500)).toEqual({ startIndex: 0, endIndex: -1 });
  });

  it('滚出内容区后仍返回末尾行区间', () => {
    const { positions, totalHeight } = measureRows(flattenTimelineGroups([group('a', 2)]));
    const window = computeWindow(positions, totalHeight + 100, 300, 0);
    expect(window.startIndex).toBe(positions.length - 1);
    expect(window.endIndex).toBe(positions.length - 1);
  });
});
