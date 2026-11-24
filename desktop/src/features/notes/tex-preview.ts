import katex from 'katex';

export interface TexRenderResult {
  html: string;
  error: string | null;
}

/**
 * TeX 预览：整段按公式渲染（displayMode）。
 * 渲染失败不阻塞编辑，返回错误信息由界面提示。
 */
export function renderTex(source: string): TexRenderResult {
  const trimmed = (source ?? '').trim();
  if (trimmed.length === 0) {
    return { html: '', error: null };
  }
  try {
    return {
      html: katex.renderToString(trimmed, {
        displayMode: true,
        throwOnError: true,
        strict: 'ignore',
        trust: false,
      }),
      error: null,
    };
  } catch (error) {
    return { html: '', error: error instanceof Error ? error.message : '公式渲染失败' };
  }
}
