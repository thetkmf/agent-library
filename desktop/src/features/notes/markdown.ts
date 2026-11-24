import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

export const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
  'img',
  'input',
] as const;

/**
 * Markdown → 安全 HTML。
 * 规范要求：禁用原始 HTML 或经 DOMPurify 白名单净化；此处两者都做（marked 输出再净化）。
 */
export function renderMarkdown(source: string): string {
  const raw = marked.parse(source ?? '', { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'class', 'type', 'checked', 'disabled', 'align'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
  });
}
