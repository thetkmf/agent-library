import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@/api/queries/graph';
import { computeForceLayout, layoutSeedOf } from '@/features/graph/layout';

function node(id: string, type = 'item'): GraphNode {
  return { id, label: `节点 ${id}`, type, weight: 0.5, item_id: type === 'item' ? id : null };
}

function edge(id: string, source: string, target: string): GraphEdge {
  return { id, source, target, relation: 'related_to', weight: 0.6 };
}

describe('computeForceLayout', () => {
  it('空图返回空数组，单节点居中', () => {
    expect(computeForceLayout([], [])).toEqual([]);
    const single = computeForceLayout([node('a')], [], { width: 400, height: 300 });
    expect(single).toEqual([{ id: 'a', x: 200, y: 150 }]);
  });

  it('所有节点落在画布内', () => {
    const nodes = Array.from({ length: 24 }, (_, index) => node(`n${index}`));
    const edges = [
      edge('e1', 'n0', 'n1'),
      edge('e2', 'n1', 'n2'),
      edge('e3', 'n3', 'n4'),
      edge('e4', 'n5', 'n6'),
    ];
    const positions = computeForceLayout(nodes, edges, { width: 600, height: 400, padding: 20 });
    expect(positions).toHaveLength(nodes.length);
    for (const point of positions) {
      expect(point.x).toBeGreaterThanOrEqual(20 - 0.5);
      expect(point.x).toBeLessThanOrEqual(580 + 0.5);
      expect(point.y).toBeGreaterThanOrEqual(20 - 0.5);
      expect(point.y).toBeLessThanOrEqual(380 + 0.5);
    }
  });

  it('同一 seed 输出稳定（可复现截图与测试）', () => {
    const nodes = Array.from({ length: 12 }, (_, index) => node(`n${index}`));
    const edges = [edge('e1', 'n0', 'n5'), edge('e2', 'n2', 'n7')];
    const first = computeForceLayout(nodes, edges, { seed: 7 });
    const second = computeForceLayout(nodes, edges, { seed: 7 });
    expect(first).toEqual(second);
  });

  it('不同 seed 得到不同布局', () => {
    const nodes = Array.from({ length: 8 }, (_, index) => node(`n${index}`));
    const first = computeForceLayout(nodes, [], { seed: 1 });
    const second = computeForceLayout(nodes, [], { seed: 99 });
    expect(first).not.toEqual(second);
  });

  it('边引用的缺失节点被忽略且不影响输出数量', () => {
    const nodes = [node('a'), node('b')];
    const positions = computeForceLayout(nodes, [edge('bad', 'a', 'missing')]);
    expect(positions).toHaveLength(2);
  });

  it('layoutSeedOf 对同一节点集合稳定', () => {
    const nodes = [node('a'), node('b')];
    expect(layoutSeedOf(nodes)).toBe(layoutSeedOf([...nodes]));
    expect(layoutSeedOf(nodes)).not.toBe(layoutSeedOf([node('b'), node('a')]));
  });
});
