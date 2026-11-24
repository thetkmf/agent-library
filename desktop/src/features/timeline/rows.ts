/**
 * 虚拟滚动的纯计算：分组 → 扁平行 → 行位置 → 可见区间。
 * 与 React 解耦，便于单测 10k 条目下的区间计算。
 */
import type { TimelineGroup, TimelineItem } from '@/api/contracts/timeline';

export type TimelineRow =
  | {
      kind: 'group';
      key: string;
      label: string;
      count: number;
      groupIndex: number;
    }
  | {
      kind: 'item';
      item: TimelineItem;
      groupIndex: number;
    };

export const TIMELINE_HEADER_HEIGHT = 36;
export const TIMELINE_ITEM_HEIGHT = 104;

export interface RowPosition {
  top: number;
  height: number;
}

export function flattenTimelineGroups(groups: readonly TimelineGroup[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  groups.forEach((group, groupIndex) => {
    if (group.items.length === 0) {
      return;
    }
    rows.push({
      kind: 'group',
      key: group.key,
      label: group.label,
      count: group.item_count,
      groupIndex,
    });
    for (const item of group.items) {
      rows.push({ kind: 'item', item, groupIndex });
    }
  });
  return rows;
}

export function measureRows(rows: readonly TimelineRow[]): {
  positions: RowPosition[];
  totalHeight: number;
} {
  const positions: RowPosition[] = [];
  let top = 0;
  for (const row of rows) {
    const height = row.kind === 'group' ? TIMELINE_HEADER_HEIGHT : TIMELINE_ITEM_HEIGHT;
    positions.push({ top, height });
    top += height;
  }
  return { positions, totalHeight: top };
}

/** 首个“底部越过 top”的行下标；找不到返回数组长度。 */
export function findFirstVisibleIndex(
  positions: readonly RowPosition[],
  top: number,
): number {
  let low = 0;
  let high = positions.length - 1;
  let result = positions.length;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const position = positions[mid];
    if (!position) {
      break;
    }
    if (position.top + position.height > top) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return result;
}

/** 最后一个“顶部早于 bottom”的行下标；找不到返回 -1。 */
export function findLastVisibleIndex(
  positions: readonly RowPosition[],
  bottom: number,
): number {
  let low = 0;
  let high = positions.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const position = positions[mid];
    if (!position) {
      break;
    }
    if (position.top < bottom) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}
