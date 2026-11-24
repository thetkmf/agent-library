import { describe, expect, it } from 'vitest';
import { highlightSnippet, queryTokens } from '@/features/search/highlight';

describe('queryTokens', () => {
  it('按空白切分、去重、保留大小写', () => {
    expect(queryTokens('  向量 检索 vector Vector ')).toEqual(['向量', '检索', 'vector']);
  });

  it('空查询返回空数组', () => {
    expect(queryTokens('   ')).toEqual([]);
  });
});

describe('highlightSnippet', () => {
  it('命中片段单独标记，保持原文顺序与大小写', () => {
    // 查询未含空格时按整体短语高亮
    const parts = highlightSnippet('通过向量检索找到相关内容', '向量检索');
    expect(parts).toEqual([
      { text: '通过', hit: false },
      { text: '向量检索', hit: true },
      { text: '找到相关内容', hit: false },
    ]);

    // 含空格时拆词分别高亮
    expect(highlightSnippet('通过向量检索找到相关内容', '向量 找到')).toEqual([
      { text: '通过', hit: false },
      { text: '向量', hit: true },
      { text: '检索', hit: false },
      { text: '找到', hit: true },
      { text: '相关内容', hit: false },
    ]);
  });

  it('大小写不敏感且保留命中文本原样', () => {
    const parts = highlightSnippet('使用 RRF 融合结果，rrf 权重可调', 'rrf');
    expect(parts.filter((part) => part.hit).map((part) => part.text)).toEqual(['RRF', 'rrf']);
  });

  it('无命中时整体作为非高亮片段', () => {
    expect(highlightSnippet('无关内容', '向量')).toEqual([{ text: '无关内容', hit: false }]);
  });

  it('空查询或空片段不崩溃', () => {
    expect(highlightSnippet('内容', '   ')).toEqual([{ text: '内容', hit: false }]);
    expect(highlightSnippet('', '向量')).toEqual([{ text: '', hit: false }]);
  });

  it('正则元字符按字面处理', () => {
    const parts = highlightSnippet('公式 a+b 与 a*b', 'a+b');
    expect(parts.filter((part) => part.hit)).toHaveLength(1);
    expect(parts.find((part) => part.hit)?.text).toBe('a+b');
  });

  it('不产生 HTML（仅文本片段）', () => {
    const parts = highlightSnippet('<script>alert(1)</script> 向量', '向量');
    const joined = parts.map((part) => part.text).join('');
    expect(joined).toContain('<script>');
    // 只是文本，不会被解释为标签
    expect(parts.every((part) => typeof part.text === 'string')).toBe(true);
  });
});
