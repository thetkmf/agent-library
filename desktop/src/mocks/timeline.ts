/**
 * F4 契约 Mock：`/timeline`、`/tags`、`POST /items/{id}/tags`、
 * `DELETE /items/{id}/tags/{tag_id}`。
 *
 * 依据《开发接口标准》9.2 / 9.3 与《开发过程》13.6；B3 合入后删除本文件、
 * 从 `src/mocks/index.ts` 移除路由，并重跑 `npm run gen:api` 切换真实接口。
 * 这里只做 fetch 层替身，请求仍经过 `src/api/client.ts`。
 */
import type { Item, ItemStatus, ItemType, TagRef } from '@/api/queries/items';
import type {
  TimelineGroupBy,
  TimelinePage,
  Tag,
} from '@/api/contracts/timeline';
import { API_ERROR_CODES } from '@/api/errors';
import {
  groupTimelineItems,
  isValidTimeZone,
  timelineGroupKey,
} from '@/features/timeline/grouping';
import { fail, ok } from './envelope';
import type { MockResponse, MockRoute } from './router';

const TAGS: ReadonlyArray<{ id: string; name: string }> = [
  { id: '0199b100-0000-7000-8000-000000000001', name: '机器学习' },
  { id: '0199b100-0000-7000-8000-000000000002', name: '检索' },
  { id: '0199b100-0000-7000-8000-000000000003', name: '数学' },
  { id: '0199b100-0000-7000-8000-000000000004', name: '周会' },
  { id: '0199b100-0000-7000-8000-000000000005', name: '阅读' },
];

const GROUP_BYS: readonly TimelineGroupBy[] = ['day', 'week', 'month'];
const TYPES: readonly ItemType[] = ['note', 'tex', 'file'];
const STATUSES: readonly ItemStatus[] = ['active', 'archived', 'trashed'];

export interface TimelineMockSeedOptions {
  /** 条目数量；性能验证可用 10_000 */
  count?: number;
  /** 基准时间（最新条目），默认当前时间 */
  now?: Date | string;
  /** 相邻条目的时间间隔（毫秒），默认 3 小时 */
  intervalMs?: number;
}

let items: Item[] = [];
let tagRecords: Tag[] = [];
let seeded = false;

function previewOf(content: string): string {
  return content.replace(/[#*`>_~-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function makeFile(index: number, createdAt: string): NonNullable<Item['file']> {
  return {
    id: `0199b200-0000-7000-8000-${String(index).padStart(12, '0')}`,
    original_name: `附件-${index + 1}.pdf`,
    mime_type: 'application/pdf',
    size_bytes: 1024 * (index + 1),
    sha256: '0'.repeat(64),
    download_url: `/files/0199b200-0000-7000-8000-${String(index).padStart(12, '0')}/download`,
    created_at: createdAt,
  };
}

function makeItem(index: number, createdAt: Date): Item {
  const type: ItemType = index % 9 === 0 ? 'file' : index % 3 === 0 ? 'tex' : 'note';
  const status: ItemStatus = index % 23 === 0 ? 'archived' : 'active';
  const tagRefs: TagRef[] = [];
  const pushTag = (tagIndex: number): void => {
    const tag = TAGS[tagIndex];
    if (tag && !tagRefs.some((entry) => entry.id === tag.id)) {
      tagRefs.push({ id: tag.id, name: tag.name });
    }
  };
  if (index % 2 === 0) {
    pushTag(0);
  }
  if (index % 3 === 0) {
    pushTag(1);
  }
  if (index % 5 === 0) {
    pushTag(2);
  }

  const label = type === 'tex' ? '公式' : type === 'file' ? '文件' : '笔记';
  const title = `${label} ${index + 1}`;
  const content = type === 'file' ? null : `# ${title}\n\n时间轴 mock 内容 ${index + 1}`;
  const iso = createdAt.toISOString();
  return {
    id: `0199c000-0000-7000-8000-${String(index).padStart(12, '0')}`,
    type,
    title,
    content,
    preview: content ? previewOf(content) : '',
    tags: tagRefs,
    file: type === 'file' ? makeFile(index, iso) : null,
    status,
    version: 1,
    embedding_status: 'pending',
    ai_summary: null,
    created_at: iso,
    updated_at: iso,
    deleted_at: null,
    idempotent_replay: false,
  };
}

/** 重新生成 mock 数据；测试可固定 `now` 与数量以获得确定结果。 */
export function resetTimelineMocks(options: TimelineMockSeedOptions = {}): void {
  const count = Math.max(0, options.count ?? 180);
  const base = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const intervalMs = options.intervalMs ?? 3 * 60 * 60 * 1000;
  const tagCreatedAt = new Date(base.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  tagRecords = TAGS.map((tag) => ({
    id: tag.id,
    name: tag.name,
    item_count: 0,
    created_at: tagCreatedAt,
  }));
  items = Array.from({ length: count }, (_, index) =>
    makeItem(index, new Date(base.getTime() - index * intervalMs)),
  );
  seeded = true;
}

function ensureSeeded(): void {
  if (!seeded) {
    resetTimelineMocks();
  }
}

/** 当前标签及其实时 `item_count`（只统计 active 条目，契约 9.3）。 */
function currentTags(): Tag[] {
  ensureSeeded();
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.status !== 'active') {
      continue;
    }
    for (const tag of item.tags ?? []) {
      counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1);
    }
  }
  return tagRecords
    .map((tag) => ({ ...tag, item_count: counts.get(tag.id) ?? 0 }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

function parseIso(raw: string | null): number | null | 'invalid' {
  if (!raw) {
    return null;
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? 'invalid' : ms;
}

function isKnown<T extends string>(values: readonly T[], candidate: string): candidate is T {
  return (values as readonly string[]).includes(candidate);
}

function badQuery(message: string): MockResponse {
  return fail(API_ERROR_CODES.unsupportedQuery, message, 400);
}

function listTimeline(searchParams: URLSearchParams): MockResponse {
  ensureSeeded();

  const rawGroupBy = searchParams.get('group_by') ?? 'day';
  if (!isKnown(GROUP_BYS, rawGroupBy)) {
    return badQuery('group_by 仅支持 day/week/month');
  }
  const timeZone = searchParams.get('tz') ?? 'UTC';
  if (!isValidTimeZone(timeZone)) {
    return badQuery(`无效的 tz：${timeZone}`);
  }

  const from = parseIso(searchParams.get('from'));
  if (from === 'invalid') {
    return badQuery('from 不是合法的 ISO 8601 时间');
  }
  const to = parseIso(searchParams.get('to'));
  if (to === 'invalid') {
    return badQuery('to 不是合法的 ISO 8601 时间');
  }
  if (from !== null && to !== null && from > to) {
    return badQuery('from 不能晚于 to');
  }

  const rawTypes = searchParams.getAll('type');
  for (const raw of rawTypes) {
    if (!isKnown(TYPES, raw)) {
      return badQuery(`不支持的条目类型：${raw}`);
    }
  }
  const rawStatus = searchParams.get('status') ?? 'active';
  if (!isKnown(STATUSES, rawStatus)) {
    return badQuery(`不支持的条目状态：${rawStatus}`);
  }
  const tagId = searchParams.get('tag_id');
  const q = (searchParams.get('q') ?? '').trim();

  const rawLimit = searchParams.get('limit');
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit <= 0) {
    return badQuery('limit 必须是正整数');
  }
  const effectiveLimit = Math.min(limit, 200);

  const rawCursor = searchParams.get('cursor');
  const offset = rawCursor === null ? 0 : Number(rawCursor);
  if (!Number.isInteger(offset) || offset < 0) {
    return badQuery('cursor 无效');
  }

  const filtered = items
    .filter((item) => item.status === rawStatus)
    .filter((item) => (rawTypes.length === 0 ? true : rawTypes.includes(item.type)))
    .filter((item) => (tagId ? (item.tags ?? []).some((tag) => tag.id === tagId) : true))
    .filter((item) =>
      q.length === 0 ? true : `${item.title}\n${item.preview}`.toLowerCase().includes(q.toLowerCase()),
    )
    .filter((item) => {
      const created = Date.parse(item.created_at);
      if (from !== null && created < from) {
        return false;
      }
      if (to !== null && created > to) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const byTime = right.created_at.localeCompare(left.created_at);
      return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
    });

  const counts = new Map<string, number>();
  for (const item of filtered) {
    const key = timelineGroupKey(item.created_at, rawGroupBy, timeZone);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const pageItems = filtered.slice(offset, offset + effectiveLimit);
  const groups = groupTimelineItems(
    pageItems,
    rawGroupBy,
    timeZone,
    Object.fromEntries(counts),
  );
  const hasMore = offset + pageItems.length < filtered.length;
  const page: TimelinePage = {
    groups,
    next_cursor: hasMore ? String(offset + pageItems.length) : null,
    has_more: hasMore,
  };
  return ok(page);
}

function findItem(itemId: string): Item | undefined {
  ensureSeeded();
  return items.find((item) => item.id === itemId && item.status !== 'trashed');
}

function attachTags(itemId: string, text: string): MockResponse {
  const item = findItem(itemId);
  if (!item) {
    return fail(API_ERROR_CODES.notFound, '条目不存在', 404);
  }
  let body: { tag_ids?: unknown };
  try {
    body = JSON.parse(text || '{}') as { tag_ids?: unknown };
  } catch {
    return fail(API_ERROR_CODES.validation, '请求体不是合法 JSON', 422);
  }
  if (
    !Array.isArray(body.tag_ids) ||
    body.tag_ids.some((value) => typeof value !== 'string')
  ) {
    return fail(API_ERROR_CODES.validation, 'tag_ids 必须是字符串数组', 422);
  }

  const next = [...(item.tags ?? [])];
  const known = new Set(next.map((tag) => tag.id));
  let changed = false;
  for (const tagId of body.tag_ids as string[]) {
    const tag = tagRecords.find((entry) => entry.id === tagId);
    if (!tag) {
      return fail(API_ERROR_CODES.notFound, `标签不存在：${tagId}`, 404);
    }
    // 契约 9.3：重复关联幂等
    if (!known.has(tag.id)) {
      known.add(tag.id);
      next.push({ id: tag.id, name: tag.name });
      changed = true;
    }
  }
  if (changed) {
    item.tags = next;
    item.version += 1;
    item.updated_at = new Date().toISOString();
  }
  return ok(item);
}

function detachTag(itemId: string, tagId: string): MockResponse {
  const item = findItem(itemId);
  if (!item) {
    return fail(API_ERROR_CODES.notFound, '条目不存在', 404);
  }
  if (!(item.tags ?? []).some((tag) => tag.id === tagId)) {
    // 契约 9.3：解除不存在的关联返回 404 + 30001
    return fail(API_ERROR_CODES.notFound, '该条目未关联此标签', 404);
  }
  item.tags = (item.tags ?? []).filter((tag) => tag.id !== tagId);
  item.version += 1;
  item.updated_at = new Date().toISOString();
  return ok(item);
}

/** F4 mock 路由；场景 id 与任务对齐，便于 B3 合入后逐条删除。 */
export const tagTimelineMockRoutes: MockRoute[] = [
  {
    id: 'F4/timeline',
    method: 'GET',
    pattern: /^\/timeline$/,
    handler: (request) => listTimeline(request.searchParams),
  },
  {
    id: 'F4/tags-list',
    method: 'GET',
    pattern: /^\/tags$/,
    handler: () => ok(currentTags()),
  },
  {
    id: 'F4/item-tags-attach',
    method: 'POST',
    pattern: /^\/items\/([^/]+)\/tags$/,
    handler: (request, params) => attachTags(params[0] ?? '', request.text),
  },
  {
    id: 'F4/item-tags-detach',
    method: 'DELETE',
    pattern: /^\/items\/([^/]+)\/tags\/([^/]+)$/,
    handler: (_request, params) => detachTag(params[0] ?? '', params[1] ?? ''),
  },
];

/** 测试用：读取 mock 数据快照。 */
export function listMockTimelineItems(): Item[] {
  ensureSeeded();
  return items.map((item) => ({ ...item, tags: [...(item.tags ?? [])] }));
}

/** 测试用：读取标签快照（含实时 `item_count`）。 */
export function listMockTags(): Tag[] {
  return currentTags();
}
