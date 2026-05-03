/**
 * SQLite connector via better-sqlite3 (synchronous API wrapped in async interface).
 * Live stats: SQLite has no concurrent query visibility, so we simulate activity
 * based on a query-event registry maintained externally (see demo mode).
 * For real SQLite usage, live stats reflect the simulated activity injected via
 * the `recordActivity` method.
 */
import Database from 'better-sqlite3';
import type { ConnectionConfig, ColumnInfo, GraphNode, GraphEdge, ActivityEvent } from '@db-cosmos/shared';
import type { DBConnector, IntrospectionResult, LiveStats } from './types';

export class SQLiteConnector implements DBConnector {
  private db: Database.Database | null = null;
  private readonly config: ConnectionConfig;
  private connected = false;
  private readonly activityLog: ActivityEvent[] = [];

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  /** Expose underlying database handle for demo seeding and activity injection */
  getDatabase(): Database.Database {
    if (!this.db) throw new Error('Not connected');
    return this.db;
  }

  /** Inject synthetic activity (used in demo mode) */
  recordActivity(event: ActivityEvent): void {
    this.activityLog.push(event);
    if (this.activityLog.length > 200) this.activityLog.splice(0, 100);
  }

  async connect(): Promise<void> {
    // ':memory:' for in-memory demo database
    this.db = new Database(this.config.database, { readonly: false });
    // Enable WAL mode for better concurrent read performance
    if (this.config.database !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async introspect(): Promise<IntrospectionResult> {
    if (!this.db) throw new Error('Not connected');

    const tableRows = this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as { name: string }[];

    const nodes: Omit<GraphNode, 'metrics'>[] = [];
    const edges: GraphEdge[] = [];
    const edgeIds = new Set<string>();

    for (const { name } of tableRows) {
      const columns: ColumnInfo[] = [];

      // Column info
      const colRows = this.db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all() as {
        name: string; type: string; notnull: number; pk: number;
      }[];

      for (const col of colRows) {
        columns.push({
          name: col.name,
          type: col.type,
          nullable: col.notnull === 0,
          isPrimaryKey: col.pk > 0,
          isForeignKey: false,
        });
      }

      // Foreign keys
      const fkRows = this.db.prepare(`PRAGMA foreign_key_list(${JSON.stringify(name)})`).all() as {
        id: number; seq: number; table: string; from: string; to: string;
      }[];

      for (const fk of fkRows) {
        const col = columns.find(c => c.name === fk.from);
        if (col) {
          col.isForeignKey = true;
          col.referencesTable = `main.${fk.table}`;
          col.referencesColumn = fk.to;
        }
        const edgeId = `${name}_${fk.from}_${fk.table}_${fk.to}`;
        if (!edgeIds.has(edgeId)) {
          edgeIds.add(edgeId);
          edges.push({
            id: edgeId,
            source: `main.${name}`,
            target: `main.${fk.table}`,
            sourceColumn: fk.from,
            targetColumn: fk.to ?? 'id',
          });
        }
      }

      // Row count
      const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM ${JSON.stringify(name)}`).get() as { cnt: number };

      nodes.push({
        id: `main.${name}`,
        label: name,
        schema: 'main',
        rowCount: countRow?.cnt ?? 0,
        columns,
      });
    }

    return { nodes, edges };
  }

  querySample(_schema: string, table: string): Promise<Record<string, unknown>[]> {
    if (!this.db) return Promise.resolve([]);
    const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
    try {
      const rows = this.db.prepare(`SELECT * FROM "${safeTable}" LIMIT 10`).all();
      return Promise.resolve(rows as Record<string, unknown>[]);
    } catch {
      return Promise.resolve([]);
    }
  }

  async getLiveStats(): Promise<LiveStats> {
    // Drain recent activity log and reset
    const recent = this.activityLog.splice(0);
    const tableQueryCounts: Record<string, number> = {};
    for (const ev of recent) {
      for (const t of ev.sourceTables) {
        tableQueryCounts[t] = (tableQueryCounts[t] ?? 0) + 1;
      }
    }
    return { activities: recent, tableQueryCounts };
  }
}
