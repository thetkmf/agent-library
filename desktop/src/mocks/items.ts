/**
 * 条目 Mock 数据与处理器（F3；部分列表能力供 F4 复用）
 * 字段严格对齐《开发接口标准》8.1 Item，不新增字段。
 */
import { API_ERROR_CODES } from '@/api/errors';
import { fail, ok } from './envelope';
import type { MockRoute } from './router';

export type MockItemType = 'note' | 'tex' | 'file';
export type MockItemStatus = 'active' | 'archived' | 'trashed';

export interface MockTagRef {
  id: string;
  name: string;
}

export interface MockItem {
  id: string;
  type: MockItemType;
  title: string;
  content: string | null;
  preview: string;
  tags: MockTagRef[];
  file: null;
  status: MockItemStatus;
  version: number;
  embedding_status: 'pending' | 'indexed' | 'failed' | 'skipped';
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface StoredItem {
  item: MockItem;
  /** 正文单独存放，模拟 `GET /items/{id}/content` 的 text/plain 语义 */
  content: string;
  /** 幂等键 → 首次创建结果 id */
  idempotency: Map<string, string>;
}

const store = new Map<string, StoredItem>();
let seeded = false;

export function previewOf(content: string): string {
  return content.replace(/[#*`>_~-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function isoOffsetMinutes(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function seed(): void {
  if (seeded) {
    return;
  }
  seeded = true;
  const seedData: Array<{
    type: MockItemType;
    title: string;
    content: string;
    tags: MockTagRef[];
    minutesAgo: number;
  }> = [
    {
      type: 'note',
      title: '向量检索笔记',
      content: '# 向量检索\n\n通过嵌入模型把文本映射到向量空间，再做近邻检索。\n',
      tags: [
        { id: 'tag-ml', name: '机器学习' },
        { id: 'tag-ir', name: '检索' },
      ],
      minutesAgo: 30,
    },
    {
      type: 'tex',
      title: '贝叶斯公式',
      content: 'P(A|B) = \\frac{P(B|A)\\,P(A)}{P(B)}',
      tags: [{ id: 'tag-math', name: '数学' }],
      minutesAgo: 300,
    },
    {
      type: 'note',
      title: '周会纪要',
      content: '- 完成 B0 骨架\n- 前端 F0–F2 完成\n',
      tags: [],
      minutesAgo: 1_500,
    },
  ];

  seedData.forEach((entry) => {
    const id = crypto.randomUUID();
    const createdAt = isoOffsetMinutes(entry.minutesAgo);
    store.set(id, {
      item: {
        id,
        type: entry.type,
        title: entry.title,
        content: entry.content,
        preview: previewOf(entry.content),
        tags: entry.tags,
        file: null,
        status: 'active',
        version: 1,
        embedding_status: 'pending',
        ai_summary: null,
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
      },
      content: entry.content,
      idempotency: new Map(),
    });
  });
}

export function resetItemMocks(): void {
  store.clear();
  seeded = false;
  seed();
}

function toItem(stored: StoredItem): MockItem {
  return { ...stored.item, content: stored.content, preview: previewOf(stored.content) };
}

function findItem(id: string): StoredItem | undefined {
  const stored = store.get(id);
  if (!stored || stored.item.status === 'trashed') {
    return undefined;
  }
  return stored;
}

function notFound(): ReturnType<typeof fail> {
  return fail(API_ERROR_CODES.notFound, '条目不存在', 404);
}

interface CreateBody {
  type?: MockItemType;
  title?: string;
  content?: string;
  tags?: string[];
}

function createItem(requestText: string, headers: Headers): ReturnType<typeof ok> | ReturnType<typeof fail> {
  let body: CreateBody;
  try {
    body = JSON.parse(requestText) as CreateBody;
  } catch {
    return fail(API_ERROR_CODES.validation, '请求体不是合法 JSON', 422);
  }

  const type = body.type ?? 'note';
  if (type !== 'note' && type !== 'tex' && type !== 'file') {
    return fail(API_ERROR_CODES.validation, 'type 取值不合法', 422);
  }
  const title = (body.title ?? '').trim();
  if (title.length === 0 || title.length > 200) {
    return fail(API_ERROR_CODES.validation, 'title 长度需为 1–200 字符', 422);
  }
  const content = body.content ?? '';
  if (type !== 'file' && content.trim().length === 0) {
    return fail(API_ERROR_CODES.validation, 'content 不能为空', 422);
  }

  const idempotencyKey = headers.get('Idempotency-Key');
  if (idempotencyKey) {
    for (const stored of store.values()) {
      const existingId = stored.idempotency.get(idempotencyKey);
      if (existingId && store.has(existingId)) {
        return ok({ ...toItem(store.get(existingId) as StoredItem), idempotent_replay: true });
      }
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const stored: StoredItem = {
    item: {
      id,
      type,
      title,
      content,
      preview: previewOf(content),
      tags: (body.tags ?? []).map((name) => ({ id: `tag-${name}`, name })),
      file: null,
      status: 'active',
      version: 1,
      embedding_status: 'pending',
      ai_summary: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
    content,
    idempotency: new Map(),
  };
  if (idempotencyKey) {
    stored.idempotency.set(idempotencyKey, id);
  }
  store.set(id, stored);
  return ok(toItem(stored), { status: 201 });
}

function listItems(searchParams: URLSearchParams): ReturnType<typeof ok> {
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('page_size') ?? '20') || 20));
  const type = searchParams.getAll('type');
  const status = searchParams.get('status');
  const q = searchParams.get('q');

  const all = Array.from(store.values())
    .map(toItem)
    .filter((item) => item.status !== 'trashed')
    .filter((item) => (type.length === 0 ? true : type.includes(item.type)))
    .filter((item) => (status ? item.status === status : true))
    .filter((item) => (q ? `${item.title}${item.content ?? ''}`.includes(q) : true))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));

  const start = (page - 1) * pageSize;
  const items = all.slice(start, start + pageSize);
  return ok({
    items,
    page,
    page_size: pageSize,
    total: all.length,
    has_more: start + items.length < all.length,
  });
}

export const itemRoutes: MockRoute[] = [
  {
    id: 'F3/items-list',
    method: 'GET',
    pattern: /^\/items$/,
    handler: (request) => listItems(request.searchParams),
  },
  {
    id: 'F3/item-create',
    method: 'POST',
    pattern: /^\/items$/,
    handler: (request) => createItem(request.text, request.headers),
  },
  {
    id: 'F3/item-get',
    method: 'GET',
    pattern: /^\/items\/([^/]+)$/,
    handler: (_request, params) => {
      const stored = findItem(params[0] ?? '');
      return stored ? ok(toItem(stored)) : notFound();
    },
  },
  {
    id: 'F3/item-patch',
    method: 'PATCH',
    pattern: /^\/items\/([^/]+)$/,
    handler: (request, params) => {
      const stored = findItem(params[0] ?? '');
      if (!stored) {
        return notFound();
      }
      let body: { title?: string; status?: MockItemStatus };
      try {
        body = JSON.parse(request.text || '{}') as { title?: string; status?: MockItemStatus };
      } catch {
        return fail(API_ERROR_CODES.validation, '请求体不是合法 JSON', 422);
      }
      if (body.title !== undefined) {
        const title = body.title.trim();
        if (title.length === 0 || title.length > 200) {
          return fail(API_ERROR_CODES.validation, 'title 长度需为 1–200 字符', 422);
        }
        stored.item.title = title;
      }
      if (body.status) {
        stored.item.status = body.status;
      }
      stored.item.version += 1;
      stored.item.updated_at = new Date().toISOString();
      return ok(toItem(stored));
    },
  },
  {
    id: 'F3/item-content-read',
    method: 'GET',
    pattern: /^\/items\/([^/]+)\/content$/,
    handler: (_request, params) => {
      const stored = findItem(params[0] ?? '');
      if (!stored) {
        return notFound();
      }
      return { text: stored.content, contentType: 'text/plain; charset=utf-8' };
    },
  },
  {
    id: 'F3/item-content-write',
    method: 'PUT',
    pattern: /^\/items\/([^/]+)\/content$/,
    handler: (request, params) => {
      const stored = findItem(params[0] ?? '');
      if (!stored) {
        return notFound();
      }
      if (stored.item.type === 'file') {
        return fail(API_ERROR_CODES.validation, '文件类型条目不支持正文写入', 400);
      }
      const rawExpected = request.searchParams.get('expected_version');
      const expected = Number(rawExpected);
      if (!rawExpected || Number.isNaN(expected)) {
        return fail(API_ERROR_CODES.validation, 'expected_version 必填', 422);
      }
      if (expected !== stored.item.version) {
        // 契约 4.1/12.3：冲突返回 409 + 30003，data 为服务端当前对象
        return {
          ...fail(API_ERROR_CODES.versionConflict, '内容已被其他窗口修改，请刷新后重试', 409, {
            data: toItem(stored),
          }),
        };
      }
      stored.content = request.text;
      stored.item.preview = previewOf(request.text);
      stored.item.version += 1;
      stored.item.updated_at = new Date().toISOString();
      stored.item.embedding_status = 'pending';
      return ok(toItem(stored));
    },
  },
  {
    id: 'F3/item-delete',
    method: 'DELETE',
    pattern: /^\/items\/([^/]+)$/,
    handler: (_request, params) => {
      const stored = findItem(params[0] ?? '');
      if (!stored) {
        return notFound();
      }
      stored.item.status = 'trashed';
      stored.item.deleted_at = new Date().toISOString();
      stored.item.version += 1;
      return ok({ id: stored.item.id });
    },
  },
];

/** 测试与开发用：读取当前 mock 数据快照 */
export function listMockItems(): MockItem[] {
  seed();
  return Array.from(store.values()).map(toItem);
}
