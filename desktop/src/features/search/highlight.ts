/**
 * 检索结果高亮（F6-2）。
 *
 * 契约 9.5 明确 `snippet` 为纯文本、禁止后端拼 HTML；高亮在前端按文本切分，
 * 渲染时用 `<mark>` 包裹命中片段，不产生 `dangerouslySetInnerHTML`。
 */
export interface HighlightPart {
  text: string;
  hit: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把查询拆成高亮词：按空白切分，去重、忽略大小写、单字符也保留 */
export function queryTokens(query: string): string[] {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(token);
    }
  }
  return unique;
}

/** 纯文本切分为高亮/非高亮片段，保持原文顺序与大小写 */
export function highlightSnippet(snippet: string, query: string): HighlightPart[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0 || snippet.length === 0) {
    return [{ text: snippet, hit: false }];
  }

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  const parts: HighlightPart[] = [];
  let lastIndex = 0;

  for (const match of snippet.matchAll(pattern)) {
    const matched = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: snippet.slice(lastIndex, index), hit: false });
    }
    parts.push({ text: matched, hit: true });
    lastIndex = index + matched.length;
  }

  if (lastIndex < snippet.length) {
    parts.push({ text: snippet.slice(lastIndex), hit: false });
  }
  return parts.length > 0 ? parts : [{ text: snippet, hit: false }];
}
