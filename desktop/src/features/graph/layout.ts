/**
 * 轻量力导向布局（F10）：不引入图库依赖，纯函数 + 固定迭代，
 * 结果确定（同一 seed 输出稳定），便于单测与截图复现。
 */
import type { GraphEdge, GraphNode } from '@/api/queries/graph';

export interface LayoutPoint {
  id: string;
  x: number;
  y: number;
}

export interface LayoutOptions {
  width?: number;
  height?: number;
  iterations?: number;
  seed?: number;
  padding?: number;
}

/** mulberry32：确定性伪随机数，避免每次渲染布局抖动 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 计算节点坐标：斥力（两两）+ 弹簧（边）+ 向心力，迭代后归一化到画布内。
 * 算法对 N ≤ 500 足够（契约建议上限 2000 时降采样）。
 */
export function computeForceLayout(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  options: LayoutOptions = {},
): LayoutPoint[] {
  const width = options.width ?? 880;
  const height = options.height ?? 520;
  const iterations = options.iterations ?? 160;
  const padding = options.padding ?? 36;
  const random = createRandom(options.seed ?? 42);

  const count = nodes.length;
  if (count === 0) {
    return [];
  }
  if (count === 1) {
    const only = nodes[0];
    return only ? [{ id: only.id, x: width / 2, y: height / 2 }] : [];
  }

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - padding;

  const positions = nodes.map((_node, index) => {
    const angle = (index / count) * Math.PI * 2 + random() * 0.4;
    const r = radius * (0.35 + random() * 0.5);
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
  });
  const indexOf = new Map(nodes.map((node, index) => [node.id, index]));

  const edgePairs = edges
    .map((edge) => {
      const source = indexOf.get(edge.source);
      const target = indexOf.get(edge.target);
      return source !== undefined && target !== undefined ? { source, target, weight: edge.weight || 0.5 } : null;
    })
    .filter((pair): pair is { source: number; target: number; weight: number } => pair !== null);

  const repulsion = 2600 * (count > 120 ? 120 / count : 1);
  const springLength = Math.max(60, Math.min(180, radius / 2.4));
  const springStrength = 0.02;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const cooling = 1 - iteration / iterations;

    // 斥力
    for (let i = 0; i < count; i += 1) {
      const a = positions[i];
      if (!a) {
        continue;
      }
      for (let j = i + 1; j < count; j += 1) {
        const b = positions[j];
        if (!b) {
          continue;
        }
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 1) {
          dx = random() - 0.5;
          dy = random() - 0.5;
          distanceSquared = dx * dx + dy * dy + 1;
        }
        const force = repulsion / distanceSquared;
        const distance = Math.sqrt(distanceSquared);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        a.x += fx * cooling;
        a.y += fy * cooling;
        b.x -= fx * cooling;
        b.y -= fy * cooling;
      }
    }

    // 弹簧（边）
    for (const pair of edgePairs) {
      const a = positions[pair.source];
      const b = positions[pair.target];
      if (!a || !b) {
        continue;
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (distance - springLength) * springStrength * pair.weight;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      a.x += fx * cooling;
      a.y += fy * cooling;
      b.x -= fx * cooling;
      b.y -= fy * cooling;
    }

    // 向心力，避免漂移出画布
    for (const point of positions) {
      point.x += (cx - point.x) * 0.002;
      point.y += (cy - point.y) * 0.002;
    }
  }

  // 归一化到画布内（保持相对结构）
  const xs = positions.map((point) => point.x);
  const ys = positions.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const availableWidth = width - padding * 2;
  const availableHeight = height - padding * 2;

  return nodes.map((node, index) => {
    const point = positions[index] ?? { x: cx, y: cy };
    return {
      id: node.id,
      x: padding + ((point.x - minX) / spanX) * availableWidth,
      y: padding + ((point.y - minY) / spanY) * availableHeight,
    };
  });
}

export function layoutSeedOf(nodes: readonly GraphNode[]): number {
  return hashString(nodes.map((node) => node.id).join('|'));
}
