/**
 * 检索与索引 Mock —— 仅测试用的夹具。
 * B6 已合入真实 `/search`、`/index/status`；产品代码中的 mock 已删除，
 * 这份数据保留为 F6 的 UI 回归夹具（字段对齐《开发接口标准》9.5）。
 */
import { API_ERROR_CODES } from '@/api/errors';
import type {
  IndexStatus,
  MatchType,
  SearchHit,
  SearchMode,
} from '@/api/queries/search';
import { SEARCH_QUERY_MAX } from '@/api/queries/search';
import { fail, ok } from '@/mocks/envelope';
import type { MockRequest, MockResponse, MockRoute } from '@/mocks/router';

interface Doc {
  id: string;
  type: 'note' | 'tex' | 'file';
  title: string;
  body: string;
  tags: string[];
  /** 语义近义关键词（mock 用，模拟嵌入命中） */
  concepts: string[];
}

const DOCS: Doc[] = [
  {
    id: '0199d000-0000-7000-8000-000000000001',
    type: 'note',
    title: '向量检索笔记',
    body: '通过嵌入模型把文本映射到向量空间，再做近邻检索；混合检索用 RRF 融合关键词与语义结果。',
    tags: ['机器学习', '检索'],
    concepts: ['向量', '嵌入', '语义', '近邻', 'RRF', '混合'],
  },
  {
    id: '0199d000-0000-7000-8000-000000000002',
    type: 'tex',
    title: '贝叶斯公式',
    body: 'P(A|B) = P(B|A)P(A) / P(B)，用于条件概率推导。',
    tags: ['数学'],
    concepts: ['概率', '公式', '条件概率', '推导'],
  },
  {
    id: '0199d000-0000-7000-8000-000000000003',
    type: 'note',
    title: '周会纪要',
    body: '本周完成 B0 骨架与前端 F0–F2；下周计划 B1 数据模型与 F3 编辑器。',
    tags: ['周会'],
    concepts: ['会议', '计划', '进度', '纪要'],
  },
  {
    id: '0199d000-0000-7000-8000-000000000004',
    type: 'file',
    title: 'SQLite 全文检索说明',
    body: 'SQLite FTS5 提供关键词检索，配合 BM25 排序；中文需要分词或按字符切分。',
    tags: ['检索', '资料'],
    concepts: ['FTS5', '关键词', 'BM25', '分词', '数据库'],
  },
  {
    id: '0199d000-0000-7000-8000-000000000005',
    type: 'note',
    title: 'DeepSeek 接入记录',
    body: '使用 OpenAI 兼容接口，模型白名单 deepseek-chat 与 deepseek-reasoner；密钥只存凭据管理器。',
    tags: ['AI'],
    concepts: ['模型', '密钥', '接口', '流式', 'Agent'],
  },
  {
    id: '0199d000-0000-7000-8000-000000000006',
    type: 'note',
    title: '文件存储设计',
    body: '小文件走 /files，大文件 8 MB 分片；整体 sha256 校验，Range 下载支持媒体预览。',
    tags: ['存储'],
    concepts: ['分片', '上传', '下载', 'sha256', '存储'],
  },
];

let embeddingStatus: IndexStatus['embedding']['status'] = 'ready';
let runningTask: IndexStatus['task'] = null;

export interface SearchMockOptions {
  embeddingStatus?: IndexStatus['embedding']['status'];
}

export function resetSearchMocks(options: SearchMockOptions = {}): void {
  embeddingStatus = options.embeddingStatus ?? 'ready';
  runningTask = null;
}

export function listMockSearchDocs(): Doc[] {
  return DOCS.map((doc) => ({ ...doc }));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

function snippetAround(body: string, query: string): string {
  const index = body.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) {
    return body.slice(0, 200);
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(body.length, index + query.length + 140);
  return `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`;
}

function keywordScore(doc: Doc, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  const haystack = `${doc.title} ${doc.body} ${doc.tags.join(' ')}`.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    const occurrences = haystack.split(term).length - 1;
    hits += occurrences * (doc.title.toLowerCase().includes(term) ? 2 : 1);
  }
  return hits === 0 ? 0 : Math.min(1, hits / (terms.length * 3));
}

function semanticScore(doc: Doc, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  const concepts = doc.concepts.join(' ').toLowerCase();
  const matched = terms.filter((term) => concepts.includes(term)).length;
  return matched === 0 ? 0 : Math.min(1, matched / Math.max(1, terms.length));
}

function buildHits(mode: SearchMode, query: string, types: string[], tagIds: string[]): SearchHit[] {
  const terms = tokenize(query);
  const degraded = mode !== 'keyword' && embeddingStatus !== 'ready';
  const effectiveMode: SearchMode = degraded ? 'keyword' : mode;

  const hits: SearchHit[] = [];
  for (const doc of DOCS) {
    if (types.length > 0 && !types.includes(doc.type)) {
      continue;
    }
    if (tagIds.length > 0 && !tagIds.some((tag) => doc.tags.includes(tag))) {
      continue;
    }

    const keyword = keywordScore(doc, terms);
    const semantic = effectiveMode === 'keyword' ? 0 : semanticScore(doc, terms);
    const score =
      effectiveMode === 'keyword'
        ? keyword
        : effectiveMode === 'semantic'
          ? semantic
          : Math.min(1, keyword * 0.5 + semantic * 0.5);

    if (score <= 0) {
      continue;
    }

    const matchType: MatchType =
      effectiveMode === 'keyword'
        ? 'keyword'
        : semantic >= keyword
          ? 'semantic'
          : 'keyword';

    hits.push({
      item: { id: doc.id, type: doc.type, title: doc.title },
      score: Math.round(score * 100) / 100,
      snippet: snippetAround(doc.body, query.trim()),
      match_type: matchType,
    });
  }

  hits.sort((left, right) =>
    right.score !== left.score ? right.score - left.score : right.item.id.localeCompare(left.item.id),
  );
  return hits;
}

function parseSearchParams(searchParams: URLSearchParams): MockResponse | null {
  const q = (searchParams.get('q') ?? '').trim();
  if (q.length < 1 || q.length > SEARCH_QUERY_MAX) {
    return fail(API_ERROR_CODES.validation, `q 长度需为 1–${SEARCH_QUERY_MAX} 字符`, 400);
  }
  const mode = searchParams.get('mode') ?? 'hybrid';
  if (!['keyword', 'semantic', 'hybrid'].includes(mode)) {
    return fail(API_ERROR_CODES.unsupportedQuery, 'mode 只支持 keyword/semantic/hybrid', 400);
  }
  const rawLimit = searchParams.get('limit');
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(API_ERROR_CODES.unsupportedQuery, 'limit 必须在 1–100 之间', 400);
  }
  const types = searchParams.getAll('type');
  if (types.some((type) => !['note', 'tex', 'file'].includes(type))) {
    return fail(API_ERROR_CODES.unsupportedQuery, 'type 只支持 note、tex、file', 400);
  }
  return null;
}

function search(request: MockRequest): MockResponse {
  const invalid = parseSearchParams(request.searchParams);
  if (invalid) {
    return invalid;
  }
  const q = (request.searchParams.get('q') ?? '').trim();
  const requested = (request.searchParams.get('mode') ?? 'hybrid') as SearchMode;
  const limit = Number(request.searchParams.get('limit') ?? '20');
  const types = request.searchParams.getAll('type');
  const tagIds = request.searchParams.getAll('tag_id');

  const degraded = requested !== 'keyword' && embeddingStatus !== 'ready';
  const effectiveMode: SearchMode = degraded ? 'keyword' : requested;
  const all = buildHits(requested, q, types, tagIds);
  const items = all.slice(0, limit);

  return ok({
    items,
    total: all.length,
    mode: effectiveMode,
    degraded,
  });
}

function indexStatus(): MockResponse {
  const status: IndexStatus = {
    ready: embeddingStatus === 'ready',
    indexed_count: embeddingStatus === 'ready' ? DOCS.length : 0,
    pending_count: embeddingStatus === 'ready' ? 0 : DOCS.length,
    last_updated_at: embeddingStatus === 'ready' ? '2026-11-24T08:00:00Z' : null,
    embedding: {
      model: 'bge-small-zh-v1.5',
      dimension: 512,
      status: embeddingStatus,
    },
    task: runningTask,
  };
  return ok(status);
}

function reindex(text: string): MockResponse {
  if (text.trim().length > 0) {
    try {
      const body = JSON.parse(text) as { mode?: unknown };
      if (body.mode !== undefined && body.mode !== 'full' && body.mode !== 'incremental') {
        return fail(API_ERROR_CODES.validation, 'mode 只支持 incremental/full', 422);
      }
    } catch {
      return fail(API_ERROR_CODES.validation, '请求体不是合法 JSON', 422);
    }
  }
  if (embeddingStatus !== 'ready') {
    return fail(API_ERROR_CODES.modelNotConfigured, '嵌入模型不可用，无法重建索引', 409);
  }
  if (runningTask && (runningTask.status === 'queued' || runningTask.status === 'running')) {
    return fail(API_ERROR_CODES.conflict, '已有重建任务在执行', 409, { data: runningTask });
  }
  runningTask = { id: crypto.randomUUID(), status: 'queued', progress: 0 };
  return ok(
    { task_id: runningTask.id, type: 'reindex', status: 'queued', progress: 0 },
    { status: 202 },
  );
}

/** F6 mock 路由；B6 合入后逐条删除 */
export const searchMockRoutes: MockRoute[] = [
  {
    id: 'F6/search',
    method: 'GET',
    pattern: /^\/search$/,
    handler: (request: MockRequest) => search(request),
  },
  {
    id: 'F6/index-status',
    method: 'GET',
    pattern: /^\/index\/status$/,
    handler: () => indexStatus(),
  },
  {
    id: 'F6/index-reindex',
    method: 'POST',
    pattern: /^\/index\/reindex$/,
    handler: (request: MockRequest) => reindex(request.text),
  },
];
