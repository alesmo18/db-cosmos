import { create } from 'zustand';
import type {
  GraphSnapshot,
  GraphEdge,
  TableMetrics,
  ActivityEvent,
  ConnectionStatus,
  GraphNode,
} from '@db-cosmos/shared';

const MAX_ACTIVITIES = 60;

// ── Cluster computation (union-find) ─────────────────────────────────────────

function computeClusterMap(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { map: Record<string, number>; count: number } {
  const parent: Record<string, string> = {};

  function find(x: string): string {
    if (!parent[x]) parent[x] = x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(a: string, b: string): void {
    parent[find(a)] = find(b);
  }

  for (const n of nodes) find(n.id);
  for (const e of edges) union(e.source, e.target);

  const rootToCluster: Record<string, number> = {};
  let nextId = 0;
  const map: Record<string, number> = {};
  for (const n of nodes) {
    const root = find(n.id);
    if (!(root in rootToCluster)) rootToCluster[root] = nextId++;
    map[n.id] = rootToCluster[root];
  }
  return { map, count: nextId };
}

// ── Store definition ──────────────────────────────────────────────────────────

export type ZoomLevel = 'L1' | 'L2' | 'L3';

interface CosmosState {
  // Data
  graph: GraphSnapshot | null;
  metrics: Record<string, TableMetrics>;
  activities: ActivityEvent[];
  connectionStatus: ConnectionStatus;

  // Graph clusters (computed from graph)
  clusterMap: Record<string, number>;
  clusterCount: number;

  // Sample rows for L3 inspection
  sampleRows: Record<string, Record<string, unknown>[]>;

  // UI
  selectedNodeId: string | null;
  showConnectionForm: boolean;
  fps: number;
  isConnecting: boolean;

  // Zoom level (L1=galaxy, L2=orbit/focus, L3=table inspection)
  zoomLevel: ZoomLevel;

  /** Live poll interval in ms (synced to backend via WS set_poll_interval) */
  pollIntervalMs: number;

  // Actions
  setGraph: (g: GraphSnapshot) => void;
  updateMetrics: (m: Record<string, TableMetrics>) => void;
  addActivities: (a: ActivityEvent[]) => void;
  setConnectionStatus: (s: ConnectionStatus) => void;
  selectNode: (id: string | null) => void;
  setShowConnectionForm: (v: boolean) => void;
  setFps: (fps: number) => void;
  setConnecting: (v: boolean) => void;
  setZoomLevel: (level: ZoomLevel) => void;
  setSampleRows: (tableId: string, rows: Record<string, unknown>[]) => void;
  setPollIntervalMs: (ms: number) => void;
}

export const useCosmosStore = create<CosmosState>((set) => ({
  graph: null,
  metrics: {},
  activities: [],
  connectionStatus: { connected: false, driver: 'none' },
  clusterMap: {},
  clusterCount: 0,
  sampleRows: {},
  selectedNodeId: null,
  showConnectionForm: false,
  fps: 0,
  isConnecting: false,
  zoomLevel: 'L1',
  pollIntervalMs: 1000,

  setGraph: (g) =>
    set((s) => {
      const nodes = g.nodes.map((n) => ({
        ...n,
        metrics: s.metrics[n.id] ?? n.metrics,
      }));
      const merged = { ...g, nodes };
      const { map, count } = computeClusterMap(merged.nodes, merged.edges);
      return { graph: merged, clusterMap: map, clusterCount: count };
    }),

  // Only update the metrics map — never mutate graph.nodes here.
  // GalaxyView reads live hotspot directly via useCosmosStore.getState() in its
  // animation loop; Inspector subscribes to s.metrics[node.id] via its own selector.
  // This keeps graphData stable between schema reloads and prevents ForceGraph3D
  // from receiving new props (and restarting the force simulation) every second.
  updateMetrics: (m) =>
    set((s) => ({ metrics: { ...s.metrics, ...m } })),

  addActivities: (a) =>
    set((s) => {
      const combined = [...a, ...s.activities].slice(0, MAX_ACTIVITIES);
      return { activities: combined };
    }),

  setConnectionStatus: (s) => set({ connectionStatus: s }),

  selectNode: (id) =>
    set((s) => {
      // Entering L2 on click, L1 on deselect
      const zoomLevel = id
        ? (s.zoomLevel === 'L1' ? 'L2' : s.zoomLevel)
        : 'L1';
      return { selectedNodeId: id, zoomLevel };
    }),

  setShowConnectionForm: (v) => set({ showConnectionForm: v }),
  setFps: (fps) => set({ fps }),
  setConnecting: (v) => set({ isConnecting: v }),
  setZoomLevel: (level) => set({ zoomLevel: level }),

  setSampleRows: (tableId, rows) =>
    set((s) => ({ sampleRows: { ...s.sampleRows, [tableId]: rows } })),

  setPollIntervalMs: (ms) => set({ pollIntervalMs: Math.max(500, Math.min(10_000, ms)) }),
}));
