// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '@/features/notes/markdown';
import { renderTex } from '@/features/notes/tex-preview';

describe('renderMarkdown', () => {
  it('渲染常见 Markdown 语法', () => {
    const html = renderMarkdown('# 标题\n\n- 一\n- 二\n\n**粗体** 与 `code`');
    expect(html).toContain('<h1');
    expect(html).toContain('<li>');
    expect(html).toContain('<strong>');
    expect(html).toContain('<code>');
  });

  it('净化脚本与事件属性（禁用原始 HTML）', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('保留安全的链接与 img', () => {
    const html = renderMarkdown('[文档](https://example.com) ![图](https://example.com/a.png)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<img');
  });
});

describe('renderTex', () => {
  it('合法公式渲染成 KaTeX HTML', () => {
    const source = String.raw`P(A|B) = \frac{P(B|A)\,P(A)}{P(B)}`;
    const result = renderTex(source);
    expect(result.error).toBeNull();
    expect(result.html).toContain('katex');
  });

  it('非法公式返回错误但不抛异常', () => {
    const result = renderTex(String.raw`\frac{`);
    expect(result.html).toBe('');
    expect(result.error).toBeTruthy();
  });

  it('空内容不报错', () => {
    expect(renderTex('   ')).toEqual({ html: '', error: null });
  });
});
