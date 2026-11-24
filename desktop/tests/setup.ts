import '@testing-library/jest-dom/vitest';

// jsdom 未实现 scrollIntoView（AgentPage 自动滚动会用到）
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => undefined;
}
