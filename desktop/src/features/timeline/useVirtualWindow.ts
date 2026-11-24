import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { RowPosition } from './rows';

export interface UseVirtualWindowOptions {
  rowCount: number;
  positions: readonly RowPosition[];
  totalHeight: number;
  /** 上下各多渲染的行数，减少快速滚动白屏 */
  overscan?: number;
  /** 容器高度测不到时（如 jsdom）使用的兜底视口高度 */
  fallbackViewportHeight?: number;
  /** 距底部多少像素内认为是「接近底部」 */
  bottomThreshold?: number;
}

export interface VirtualWindow {
  containerRef: RefObject<HTMLDivElement>;
  scrollTop: number;
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  atBottom: boolean;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  scrollToTop: () => void;
}

const DEFAULT_OVERSCAN = 6;
const DEFAULT_VIEWPORT = 720;
const DEFAULT_BOTTOM_THRESHOLD = 240;

/**
 * 固定行高的虚拟滚动窗口计算（与渲染解耦，便于测试）。
 * 只渲染可见区间 ± overscan 的行，滚动时通过 transform 定位。
 */
export function computeWindow(
  positions: readonly RowPosition[],
  scrollTop: number,
  viewportHeight: number,
  overscan = DEFAULT_OVERSCAN,
): { startIndex: number; endIndex: number } {
  if (positions.length === 0) {
    return { startIndex: 0, endIndex: -1 };
  }
  const top = Math.max(0, scrollTop);
  const bottom = top + Math.max(1, viewportHeight);

  // 二分：首个底部越过 top 的行
  let low = 0;
  let high = positions.length - 1;
  let first = positions.length;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const position = positions[mid];
    if (!position) {
      break;
    }
    if (position.top + position.height > top) {
      first = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  // 二分：最后一个顶部早于 bottom 的行
  low = 0;
  high = positions.length - 1;
  let last = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const position = positions[mid];
    if (!position) {
      break;
    }
    if (position.top < bottom) {
      last = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (last < first) {
    // 滚动已越过内容末尾（如加载中/收起分组）：贴住末行，避免出现空窗口
    const lastIndex = positions.length - 1;
    return {
      startIndex: Math.max(0, lastIndex - overscan),
      endIndex: lastIndex,
    };
  }

  return {
    startIndex: Math.max(0, first - overscan),
    endIndex: Math.min(positions.length - 1, last + overscan),
  };
}

export function useVirtualWindow(options: UseVirtualWindowOptions): VirtualWindow {
  const {
    rowCount,
    positions,
    totalHeight,
    overscan = DEFAULT_OVERSCAN,
    fallbackViewportHeight = DEFAULT_VIEWPORT,
    bottomThreshold = DEFAULT_BOTTOM_THRESHOLD,
  } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(fallbackViewportHeight);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const measure = (): void => {
      const height = element.clientHeight;
      setViewportHeight(height > 0 ? height : fallbackViewportHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fallbackViewportHeight]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const scrollToTop = useCallback(() => {
    containerRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, []);

  const { startIndex, endIndex } = computeWindow(positions, scrollTop, viewportHeight, overscan);
  const clampedEnd = Math.min(rowCount - 1, endIndex);
  const atBottom = scrollTop + viewportHeight >= totalHeight - bottomThreshold;

  return {
    containerRef,
    scrollTop,
    startIndex,
    endIndex: clampedEnd,
    totalHeight,
    atBottom,
    onScroll,
    scrollToTop,
  };
}
