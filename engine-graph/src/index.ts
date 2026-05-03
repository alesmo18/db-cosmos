import type { GraphSnapshot, GraphNode, GraphEdge, TableMetrics } from '@db-cosmos/shared';
import type { IntrospectionResult } from '@db-cosmos/connectors';

/** Build a full GraphSnapshot from an introspection result + optional existing metrics */
export function buildGraphSnapshot(
  introspection: IntrospectionResult,
  existingMetrics?: Record<string, TableMetrics>
): GraphSnapshot {
  const { nodes: rawNodes, edges } = introspection;

  // Calculate relation density per node (in-degree + out-degree)
  const densityMap = new Map<string, number>();
  for (const edge of edges) {
    densityMap.set(edge.source, (densityMap.get(edge.source) ?? 0) + 1);
    densityMap.set(edge.target, (densityMap.get(edge.target) ?? 0) + 1);
  }

  const nodes: GraphNode[] = rawNodes.map(raw => {
    const existing = existingMetrics?.[raw.id];
    const relationDensity = densityMap.get(raw.id) ?? 0;
    return {
      ...raw,
      metrics: existing ?? defaultMetrics(raw.rowCount, relationDensity),
    };
  });

  return { nodes, edges, timestamp: Date.now() };
}

/** Merge a metrics update into an existing snapshot */
export function applyMetricsToSnapshot(
  snapshot: GraphSnapshot,
  metrics: Record<string, TableMetrics>
): GraphSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map(node => ({
      ...node,
      metrics: metrics[node.id] ?? node.metrics,
    })),
    timestamp: Date.now(),
  };
}

function defaultMetrics(rowCount: number, relationDensity: number): TableMetrics {
  return {
    queryFrequency: 0,
    rowCount,
    relationDensity,
    accessRate: 0,
    hotspotScore: 0,
    activeQueries: 0,
  };
}

/**
 * Performance note for large graphs (300+ nodes / 2000+ edges):
 * - The graph data itself is JSON-serialisable and small (<1 MB for typical schemas).
 * - For very large schemas, consider filtering to the top-N tables by hotspot before
 *   sending to the client, or implementing a "focus neighbourhood" mode where only
 *   N-hop neighbours of the selected node are rendered at full detail.
 * - react-force-graph-3d handles 300+ nodes well with cooldownTicks=100 + d3AlphaDecay=0.03.
 */
export function pruneGraph(snapshot: GraphSnapshot, maxNodes = 300): GraphSnapshot {
  if (snapshot.nodes.length <= maxNodes) return snapshot;

  // Keep the hottest nodes + those with high relation density
  const sorted = [...snapshot.nodes].sort((a, b) => {
    const scoreA = a.metrics.hotspotScore * 2 + a.metrics.relationDensity * 0.5;
    const scoreB = b.metrics.hotspotScore * 2 + b.metrics.relationDensity * 0.5;
    return scoreB - scoreA;
  });

  const keepIds = new Set(sorted.slice(0, maxNodes).map(n => n.id));
  const nodes = snapshot.nodes.filter(n => keepIds.has(n.id));
  const edges = snapshot.edges.filter(e => keepIds.has(e.source) && keepIds.has(e.target));

  return { nodes, edges, timestamp: snapshot.timestamp };
}
