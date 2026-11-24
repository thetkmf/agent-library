/**
 * 时间轴筛选（F4）：URL ↔ 筛选状态 ↔ `/timeline` 请求参数。
 *
 * URL 使用契约字段名（`type`、`status`、`tag_id`、`q`、`created_from`、
 * `created_to`、`group_by`），刷新与前进/后退都由 `useSearchParams` 还原。
 * 非法值在这里收敛成可展示错误，页面据此进入错误态而不是发请求。
 */
import type { TimelineGroupBy } from '@/api/contracts/timeline';
import type { ItemStatus, ItemType } from '@/api/queries/items';
import { isValidTimeZone, zonedWallClock } from './grouping';

export const TIMELINE_GROUP_BYS: readonly TimelineGroupBy[] = ['day', 'week', 'month'];
export const TIMELINE_TYPES: readonly ItemType[] = ['note', 'tex', 'file'];
export const TIMELINE_STATUSES: readonly ItemStatus[] = ['active', 'archived', 'trashed'];

export interface TimelineFilters {
  groupBy: TimelineGroupBy;
  types: ItemType[];
  status: ItemStatus;
  tagId: string | null;
  q: string;
  /** `YYYY-MM-DD`（本地日期，查询时转换为含边界的 ISO 8601） */
  createdFrom: string | null;
  createdTo: string | null;
}

export const DEFAULT_TIMELINE_FILTERS: TimelineFilters = {
  groupBy: 'day',
  types: [],
  status: 'active',
  tagId: null,
  q: '',
  createdFrom: null,
  createdTo: null,
};

export interface ParsedTimelineFilters {
  filters: TimelineFilters;
  errors: string[];
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isKnown<T extends string>(values: readonly T[], candidate: string): candidate is T {
  return (values as readonly string[]).includes(candidate);
}

function parseDateParam(raw: string | null, label: string, errors: string[]): string | null {
  if (!raw) {
    return null;
  }
  const match = DATE_RE.exec(raw);
  if (!match) {
    errors.push(`${label}格式应为 YYYY-MM-DD`);
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    errors.push(`${label}不是有效日期`);
    return null;
  }
  return raw;
}

/** 解析 URL 查询参数；返回归一化筛选状态与全部非法项。 */
export function parseTimelineFilters(searchParams: URLSearchParams): ParsedTimelineFilters {
  const errors: string[] = [];

  const rawTypes = searchParams
    .getAll('type')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const types: ItemType[] = [];
  for (const raw of rawTypes) {
    if (!isKnown(TIMELINE_TYPES, raw)) {
      errors.push(`不支持的条目类型：${raw}`);
      continue;
    }
    if (!types.includes(raw)) {
      types.push(raw);
    }
  }

  const rawStatus = searchParams.get('status');
  let status: ItemStatus = DEFAULT_TIMELINE_FILTERS.status;
  if (rawStatus) {
    if (isKnown(TIMELINE_STATUSES, rawStatus)) {
      status = rawStatus;
    } else {
      errors.push(`不支持的条目状态：${rawStatus}`);
    }
  }

  const rawGroupBy = searchParams.get('group_by');
  let groupBy: TimelineGroupBy = DEFAULT_TIMELINE_FILTERS.groupBy;
  if (rawGroupBy) {
    if (isKnown(TIMELINE_GROUP_BYS, rawGroupBy)) {
      groupBy = rawGroupBy;
    } else {
      errors.push(`不支持的分组方式：${rawGroupBy}`);
    }
  }

  const rawTagId = searchParams.get('tag_id');
  if (rawTagId && !UUID_RE.test(rawTagId)) {
    errors.push('标签 ID 格式不正确');
  }

  const createdFrom = parseDateParam(searchParams.get('created_from'), '开始日期', errors);
  const createdTo = parseDateParam(searchParams.get('created_to'), '结束日期', errors);
  if (createdFrom && createdTo && createdFrom > createdTo) {
    errors.push('开始日期不能晚于结束日期');
  }

  return {
    filters: {
      groupBy,
      types,
      status,
      tagId: rawTagId && rawTagId.length > 0 ? rawTagId : null,
      q: (searchParams.get('q') ?? '').trim(),
      createdFrom,
      createdTo,
    },
    errors,
  };
}

/** 仅写入非默认值，保持 URL 简洁且可被前进/后退完整还原。 */
export function filtersToSearchParams(filters: TimelineFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const type of filters.types) {
    params.append('type', type);
  }
  if (filters.status !== DEFAULT_TIMELINE_FILTERS.status) {
    params.set('status', filters.status);
  }
  if (filters.groupBy !== DEFAULT_TIMELINE_FILTERS.groupBy) {
    params.set('group_by', filters.groupBy);
  }
  if (filters.tagId) {
    params.set('tag_id', filters.tagId);
  }
  const q = filters.q.trim();
  if (q.length > 0) {
    params.set('q', q);
  }
  if (filters.createdFrom) {
    params.set('created_from', filters.createdFrom);
  }
  if (filters.createdTo) {
    params.set('created_to', filters.createdTo);
  }
  return params;
}

export function getLocalTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone.length > 0 ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * 指定时区中某面墙上时间 → UTC 时刻。标准做法：先按 UTC 猜测，再用该时刻
 * 的时区偏移修正一次，可覆盖 DST 切换日。
 */
function wallClockToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const guessMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offsetOf = (date: Date): number => {
    const wall = zonedWallClock(date, timeZone);
    const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    return asUtc - date.getTime();
  };
  const first = new Date(guessMs - offsetOf(new Date(guessMs)));
  return new Date(guessMs - offsetOf(first));
}

function parseLocalDate(date: string): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(date);
  if (!match) {
    throw new Error(`无效日期：${date}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** 本地日期 00:00:00.000 → UTC ISO（契约 from 含边界）。 */
export function localDateStartIso(date: string, timeZone: string): string {
  const { year, month, day } = parseLocalDate(date);
  return wallClockToUtc(year, month, day, timeZone).toISOString();
}

/** 本地日期 23:59:59.999 → UTC ISO（契约 to 含边界）。 */
export function localDateEndIso(date: string, timeZone: string): string {
  const { year, month, day } = parseLocalDate(date);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const next = wallClockToUtc(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
    timeZone,
  );
  return new Date(next.getTime() - 1).toISOString();
}

export interface TimelineRequest {
  group_by: TimelineGroupBy;
  tz: string;
  from?: string;
  to?: string;
  type?: ItemType[];
  status?: ItemStatus;
  tag_id?: string;
  q?: string;
  limit?: number;
}

/**
 * 构造 `/timeline` 请求参数。
 *
 * 说明：9.2 的时间轴参数表只列了 `from/to/group_by/tz/cursor/limit`，
 * 而 13.6/13.7 要求 F4 覆盖 `type/status/tag_id/q` 筛选。按契约 3.5
 * “未知参数一律忽略”，这里额外携带这些筛选参数（mock 已实现）；
 * B3 若未实现服务端筛选，联调时再切换到客户端筛选或 `/items`。
 */
export function buildTimelineRequest(
  filters: TimelineFilters,
  options: { timeZone?: string; limit?: number } = {},
): TimelineRequest {
  const timeZone = options.timeZone ?? getLocalTimeZone();
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`无效时区：${timeZone}`);
  }
  const q = filters.q.trim();
  return {
    group_by: filters.groupBy,
    tz: timeZone,
    from: filters.createdFrom ? localDateStartIso(filters.createdFrom, timeZone) : undefined,
    to: filters.createdTo ? localDateEndIso(filters.createdTo, timeZone) : undefined,
    type: filters.types.length > 0 ? filters.types : undefined,
    status: filters.status !== DEFAULT_TIMELINE_FILTERS.status ? filters.status : undefined,
    tag_id: filters.tagId ?? undefined,
    q: q.length > 0 ? q : undefined,
    limit: options.limit ?? 50,
  };
}

export function withFilters(
  filters: TimelineFilters,
  patch: Partial<TimelineFilters>,
): TimelineFilters {
  return { ...filters, ...patch };
}
