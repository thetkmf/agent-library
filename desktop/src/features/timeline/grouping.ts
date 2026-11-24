/**
 * 时间轴分组（F4）纯函数。
 *
 * 后端按 `tz` 切分日/周/月并返回 `key`/`label`；这些函数用于：
 * 1. mock 处理器按契约生成同样的分组；
 * 2. 前端跨页按 `key` 合并分组（`mergeTimelineGroups`）；
 * 3. 单元测试验证本地 0 点、跨年/跨月与周界。
 *
 * 时间切分严格按 IANA 时区的墙上时间（wall clock）计算，不依赖进程时区。
 * 周采用 ISO 8601（周一为每周第一天）。
 */
import type {
  TimelineGroup,
  TimelineGroupBy,
  TimelineItem,
} from '@/api/contracts/timeline';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/** 校验 IANA 时区字符串；非法时区返回 false（契约 9.2：40002）。 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

interface ZonedWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** 把 UTC 时刻转换为指定时区的墙上时间。 */
export function zonedWallClock(value: string | Date, timeZone: string): ZonedWallClock {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`无效时间：${String(value)}`);
  }
  const parts = zoneFormatter(timeZone).formatToParts(date);
  const read = (type: string): number => {
    const part = parts.find((entry) => entry.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

interface IsoWeekInfo {
  year: number;
  week: number;
  /** 该 ISO 周周一对应的墙上日期（以 UTC 表示，用于日期运算） */
  monday: Date;
}

function isoWeekInfo(wall: ZonedWallClock): IsoWeekInfo {
  const wallMs = Date.UTC(wall.year, wall.month - 1, wall.day);
  const dayOfWeek = (new Date(wallMs).getUTCDay() + 6) % 7; // 周一 = 0
  const thursday = new Date(wallMs + (3 - dayOfWeek) * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / WEEK_MS) + 1;
  return {
    year: isoYear,
    week,
    monday: new Date(wallMs - dayOfWeek * DAY_MS),
  };
}

function wallWeekday(wall: ZonedWallClock): string {
  const index = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  return WEEKDAY_LABELS[index] ?? '周一';
}

/**
 * 按 `tz` 计算分组 key：
 * - day：`YYYY-MM-DD`
 * - week：ISO 周 `YYYY-Www`
 * - month：`YYYY-MM`
 */
export function timelineGroupKey(
  value: string | Date,
  groupBy: TimelineGroupBy,
  timeZone: string,
): string {
  const wall = zonedWallClock(value, timeZone);
  if (groupBy === 'month') {
    return `${wall.year}-${pad2(wall.month)}`;
  }
  if (groupBy === 'week') {
    const info = isoWeekInfo(wall);
    return `${info.year}-W${pad2(info.week)}`;
  }
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}`;
}

/** 按 `tz` 生成可直接展示的分组标签。 */
export function timelineGroupLabel(
  value: string | Date,
  groupBy: TimelineGroupBy,
  timeZone: string,
): string {
  const wall = zonedWallClock(value, timeZone);
  if (groupBy === 'month') {
    return `${wall.year}年${wall.month}月`;
  }
  if (groupBy === 'week') {
    const info = isoWeekInfo(wall);
    const sunday = new Date(info.monday.getTime() + 6 * DAY_MS);
    const from = `${pad2(info.monday.getUTCMonth() + 1)}-${pad2(info.monday.getUTCDate())}`;
    const to = `${pad2(sunday.getUTCMonth() + 1)}-${pad2(sunday.getUTCDate())}`;
    return `${info.year}年第${info.week}周（${from} 至 ${to}）`;
  }
  return `${wall.year}年${wall.month}月${wall.day}日 ${wallWeekday(wall)}`;
}

/**
 * 把已按创建时间倒序排列的条目分组。`itemCounts` 用于跨页场景：
 * 分组内的 `items` 只含本页条目，`item_count` 取筛选后的分组总数。
 */
export function groupTimelineItems(
  items: readonly TimelineItem[],
  groupBy: TimelineGroupBy,
  timeZone: string,
  itemCounts?: Readonly<Record<string, number>>,
): TimelineGroup[] {
  const groups = new Map<string, TimelineGroup>();
  for (const item of items) {
    const key = timelineGroupKey(item.created_at, groupBy, timeZone);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, {
        key,
        label: timelineGroupLabel(item.created_at, groupBy, timeZone),
        item_count: itemCounts?.[key] ?? 1,
        items: [item],
      });
    }
  }
  if (itemCounts) {
    for (const group of groups.values()) {
      group.item_count = itemCounts[group.key] ?? group.items.length;
    }
  }
  return [...groups.values()];
}

/** 契约 9.2：`created_at DESC, id DESC`。 */
export function compareTimelineItems(left: TimelineItem, right: TimelineItem): number {
  const byTime = right.created_at.localeCompare(left.created_at);
  return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
}

/**
 * 跨页合并：同 key 的条目去重后拼接，`item_count` 取最大值（服务端总数），
 * 分组按首条目的创建时间倒序排列。前端不解析 key 格式。
 */
export function mergeTimelineGroups(
  pages: ReadonlyArray<ReadonlyArray<TimelineGroup>>,
): TimelineGroup[] {
  const merged = new Map<string, TimelineGroup>();
  for (const groups of pages) {
    for (const group of groups) {
      const existing = merged.get(group.key);
      if (!existing) {
        merged.set(group.key, {
          key: group.key,
          label: group.label,
          item_count: group.item_count,
          items: [...group.items],
        });
        continue;
      }
      const known = new Set(existing.items.map((item) => item.id));
      for (const item of group.items) {
        if (!known.has(item.id)) {
          known.add(item.id);
          existing.items.push(item);
        }
      }
      existing.item_count = Math.max(existing.item_count, group.item_count);
      if (group.label.length > 0) {
        existing.label = group.label;
      }
    }
  }

  const result = [...merged.values()];
  for (const group of result) {
    group.items.sort(compareTimelineItems);
  }
  result.sort((left, right) => {
    const leftFirst = left.items[0];
    const rightFirst = right.items[0];
    if (!leftFirst || !rightFirst) {
      return left.items.length === 0 ? 1 : -1;
    }
    return compareTimelineItems(leftFirst, rightFirst);
  });
  return result;
}
