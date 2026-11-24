import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Network, RefreshCw } from 'lucide-react';
import { userMessageFor } from '@/api/errors';
import { useGraph, useGraphStats, type GraphNode } from '@/api/queries/graph';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { computeForceLayout, layoutSeedOf } from './layout';

const TYPE_COLORS: Record<string, string> = {
  item: 'rgb(var(--pkb-accent))',
  tag: 'rgb(var(--pkb-success))',
  concept: 'rgb(var(--pkb-warning))',
};

const TYPE_LABEL: Record<string, string> = {
  item: '条目',
  tag: '标签',
  concept: '概念',
};

const WIDTH = 880;
const HEIGHT = 520;

/** 知识图谱（F10）：力导向布局 + 过滤 + 节点详情（自研轻量布局，不引入图库） */
export function GraphPage(): JSX.Element {
  const [depth, setDepth] = useState(2);
  const [types, setTypes] = useState<string[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);

  const graphQuery = useGraph({ depth, types: types.length > 0 ? types : undefined, limit: 500 });
  const statsQuery = useGraphStats();

  const nodes = useMemo(() => graphQuery.data?.nodes ?? [], [graphQuery.data]);
  const edges = useMemo(() => graphQuery.data?.edges ?? [], [graphQuery.data]);
  const positions = useMemo(
    () => computeForceLayout(nodes, edges, { width: WIDTH, height: HEIGHT, seed: layoutSeedOf(nodes) }),
    [nodes, edges],
  );
  const positionOf = useMemo(() => new Map(positions.map((point) => [point.id, point])), [positions]);
  const nodeOf = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const activeNode = activeNodeId ? nodeOf.get(activeNodeId) ?? null : null;
  const activeIsNode = activeNode !== null;

  const toggleType = (type: string): void => {
    setTypes((previous) =>
      previous.includes(type) ? previous.filter((entry) => entry !== type) : [...previous, type],
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-content">知识图谱</h2>
          <span className="text-xs text-muted">
            {nodes.length} 节点 · {edges.length} 条边
          </span>
        </div>

        <label className="flex items-center gap-1 text-xs text-muted">
          深度
          <select
            aria-label="子图深度"
            value={depth}
            onChange={(event) => setDepth(Number(event.target.value))}
            className="rounded border border-border bg-elevated px-1.5 py-1 text-xs text-content"
          >
            {[1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1" role="group" aria-label="节点类型">
          {Object.keys(TYPE_LABEL).map((type) => {
            const active = types.length === 0 || types.includes(type);
            return (
              <button
                key={type}
                type="button"
                aria-pressed={types.includes(type)}
                onClick={() => toggleType(type)}
                className={cn(
                  'rounded border px-2 py-1 text-xs transition-colors duration-ui',
                  active
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border text-muted hover:bg-sunken',
                )}
              >
                {TYPE_LABEL[type]}
              </button>
            );
          })}
        </div>

        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void graphQuery.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          刷新
        </Button>
      </div>

      <section className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-muted" aria-label="图谱统计">
        节点 {statsQuery.data?.node_count ?? '—'} · 边 {statsQuery.data?.edge_count ?? '—'} · 孤立节点{' '}
        {statsQuery.data?.isolated_node_count ?? '—'}
        {nodes.length > 500 ? ' · 已限制 500 节点（降采样）' : ''}
      </section>

      {graphQuery.isPending ? <Skeleton className="h-[520px] w-full" /> : null}

      {graphQuery.isError ? (
        <ErrorState
          description={userMessageFor(graphQuery.error)}
          onRetry={() => void graphQuery.refetch()}
        />
      ) : null}

      {graphQuery.isSuccess && nodes.length === 0 ? (
        <EmptyState
          icon={Network}
          title="图谱还是空的"
          description="给条目打标签或采纳 AI 关联建议后，这里会出现关系网络。"
          className="py-12"
        />
      ) : null}

      {nodes.length > 0 ? (
        <div className="flex flex-col gap-2 lg:flex-row">
          <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-[520px] w-full"
              role="img"
              aria-label={`知识图谱，${nodes.length} 个节点`}
              data-testid="graph-canvas"
            >
              {edges.map((edge) => {
                const from = positionOf.get(edge.source);
                const to = positionOf.get(edge.target);
                if (!from || !to) {
                  return null;
                }
                return (
                  <line
                    key={edge.id}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke="rgb(var(--pkb-border))"
                    strokeWidth={Math.max(0.6, (edge.weight ?? 0.4) * 2)}
                  />
                );
              })}
              {nodes.map((node) => {
                const point = positionOf.get(node.id);
                if (!point) {
                  return null;
                }
                const radius = 5 + Math.min(8, (node.weight ?? 0) * 8);
                return (
                  <g key={node.id} transform={`translate(${point.x} ${point.y})`}>
                    <circle
                      r={radius}
                      fill={TYPE_COLORS[node.type] ?? 'rgb(var(--pkb-muted))'}
                      fillOpacity={activeNodeId === node.id ? 1 : 0.78}
                      stroke={activeNodeId === node.id ? 'rgb(var(--pkb-content))' : 'none'}
                      strokeWidth={1.5}
                      role="button"
                      tabIndex={0}
                      aria-label={`${TYPE_LABEL[node.type] ?? node.type}：${node.label}`}
                      onClick={() => setActiveNodeId(node.id === activeNodeId ? null : node.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setActiveNodeId(node.id === activeNodeId ? null : node.id);
                        }
                      }}
                      className="cursor-pointer"
                    />
                    {nodes.length <= 80 || activeNodeId === node.id ? (
                      <text y={radius + 11} textAnchor="middle" className="fill-[rgb(var(--pkb-muted))] text-[10px]">
                        {node.label.length > 12 ? `${node.label.slice(0, 12)}…` : node.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>

          <aside className="w-full shrink-0 rounded-lg border border-border bg-elevated px-3 py-2 lg:w-64" aria-label="节点详情">
            {activeIsNode && activeNode ? (
              <>
                <h3 className="text-sm font-medium text-content">{activeNode.label}</h3>
                <dl className="mt-1 flex flex-col gap-1 text-[11px] text-muted">
                  <div className="flex justify-between gap-2">
                    <dt>类型</dt>
                    <dd className="text-content">{TYPE_LABEL[activeNode.type] ?? activeNode.type}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>权重</dt>
                    <dd className="text-content">{(activeNode.weight ?? 0).toFixed(2)}</dd>
                  </div>
                </dl>
                {activeNode.item_id ? (
                  <Link
                    to={`/notes/${activeNode.item_id}`}
                    className="mt-2 inline-block text-xs text-accent underline underline-offset-2"
                  >
                    打开条目
                  </Link>
                ) : (
                  <p className="mt-2 text-[11px] text-muted">该节点未关联具体条目。</p>
                )}
              </>
            ) : (
              <p className="text-[11px] text-muted">
                点击节点查看详情；节点颜色区分条目 / 标签 / 概念。大图超过 500 节点时自动降采样。
              </p>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}

export type { GraphNode };
