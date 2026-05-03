import type { ColumnInfo, GraphNode, GraphEdge, ActivityEvent } from '@db-cosmos/shared';

export interface IntrospectionResult {
  nodes: Omit<GraphNode, 'metrics'>[];
  edges: GraphEdge[];
}

export interface LiveStats {
  activities: ActivityEvent[];
  /** map of tableName → query count delta since last poll */
  tableQueryCounts: Record<string, number>;
}

export interface DBConnector {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  introspect(): Promise<IntrospectionResult>;
  getLiveStats(): Promise<LiveStats>;
  isConnected(): boolean;
  /** Return up to 10 sample rows from a table. Safe read-only LIMIT query. */
  querySample(schema: string, table: string): Promise<Record<string, unknown>[]>;
}
