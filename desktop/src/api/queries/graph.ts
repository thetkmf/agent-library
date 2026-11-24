import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import { queryKeys } from '@/api/keys';
import type { components } from '@/api/generated';

/** 知识图谱（契约 9.9）。B11 已合入。 */
export type GraphNode = components['schemas']['GraphNodeOut'];
export type GraphEdge = components['schemas']['GraphEdgeOut'];
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };
export type GraphStats = components['schemas']['GraphStatsOut'];

export interface GraphQuery {
  center_id?: string;
  depth?: number;
  types?: string[];
  limit?: number;
}

export const graphApi = {
  graph: async (query: GraphQuery = {}): Promise<GraphData> => {
    const data = await apiRequest<components['schemas']['GraphOut']>('/graph', {
      query: {
        center_id: query.center_id,
        depth: query.depth,
        types: query.types,
        limit: query.limit,
      },
      retries: 0,
    });
    return { nodes: data.nodes ?? [], edges: data.edges ?? [] };
  },
  neighbors: async (itemId: string): Promise<GraphData> => {
    const data = await apiRequest<components['schemas']['GraphOut']>(
      `/graph/neighbors/${encodeURIComponent(itemId)}`,
      { retries: 0 },
    );
    return { nodes: data.nodes ?? [], edges: data.edges ?? [] };
  },
  stats: (): Promise<GraphStats> => apiRequest<GraphStats>('/graph/stats', { retries: 0 }),
};

export function useGraph(query: GraphQuery = {}) {
  return useQuery({
    queryKey: queryKeys.graph.data(query),
    queryFn: () => graphApi.graph(query),
    retry: false,
    staleTime: 30_000,
  });
}

export function useGraphStats() {
  return useQuery({
    queryKey: queryKeys.graph.stats(),
    queryFn: graphApi.stats,
    retry: false,
    staleTime: 30_000,
  });
}
