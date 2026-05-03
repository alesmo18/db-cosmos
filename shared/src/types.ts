export type DBDriver = 'postgres' | 'mysql' | 'sqlite';

export interface ConnectionConfig {
  driver: DBDriver;
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  referencesTable?: string;
  referencesColumn?: string;
}

export interface TableMetrics {
  /** queries per second (rolling 10s window) */
  queryFrequency: number;
  rowCount: number;
  /** number of FK relations (in + out) */
  relationDensity: number;
  /** reads + writes per second */
  accessRate: number;
  /** composite 0–1 heat score */
  hotspotScore: number;
  activeQueries: number;
}

export interface GraphNode {
  id: string;
  label: string;
  schema: string;
  rowCount: number;
  columns: ColumnInfo[];
  metrics: TableMetrics;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceColumn: string;
  targetColumn: string;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  timestamp: number;
}

export interface ActivityEvent {
  id: string;
  queryText: string;
  /** table name if we could map the query to a table */
  sourceTables: string[];
  state: string;
  durationMs?: number;
  timestamp: number;
}

export interface MetricsUpdate {
  tableMetrics: Record<string, TableMetrics>;
  timestamp: number;
}

export interface ConnectionStatus {
  connected: boolean;
  driver: DBDriver | 'none';
  database?: string;
  nodeCount?: number;
  edgeCount?: number;
  error?: string;
  /** true when Pagila Postgres was requested but unavailable; fell back to SQLite */
  demoFallback?: boolean;
}

export type WsMessageType =
  | 'graph_snapshot'
  | 'metrics_update'
  | 'activity_update'
  | 'connection_status'
  | 'error'
  /** Client → Server: request a new backend poll interval (clamped 500–10000 ms) */
  | 'set_poll_interval';

export interface WsMessage {
  type: WsMessageType;
  payload:
    | GraphSnapshot
    | MetricsUpdate
    | ActivityEvent[]
    | ConnectionStatus
    | { message: string }
    | { intervalMs: number };
}
