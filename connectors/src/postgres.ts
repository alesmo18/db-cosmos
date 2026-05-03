import { Pool } from 'pg';
import type { ConnectionConfig, ColumnInfo, GraphNode, GraphEdge, ActivityEvent } from '@db-cosmos/shared';
import type { DBConnector, IntrospectionResult, LiveStats } from './types';

export class PostgresConnector implements DBConnector {
  private pool: Pool | null = null;
  private readonly config: ConnectionConfig;
  private connected = false;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.pool = new Pool({
      host: this.config.host ?? 'localhost',
      port: this.config.port ?? 5432,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      max: 5,
      connectionTimeoutMillis: 5000,
    });
    // Verify connection
    const client = await this.pool.connect();
    client.release();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Run ANALYZE on the database (or a single schema) to refresh pg_stat_user_tables
   * row-count estimates.  Safe to call on read-only demo containers; should NOT be
   * called automatically on arbitrary production connections.
   */
  async analyze(schema?: string): Promise<void> {
    if (!this.pool) throw new Error('Not connected');
    // Sanitise — only allow identifier characters
    const safeSchema = schema ? `"${schema.replace(/[^a-zA-Z0-9_]/g, '')}"` : '';
    await this.pool.query(`ANALYZE ${safeSchema}`);
  }

  async introspect(): Promise<IntrospectionResult> {
    if (!this.pool) throw new Error('Not connected');

    // Row count strategy:
    //   1. n_live_tup from pg_stat_user_tables (accurate after ANALYZE)
    //   2. reltuples from pg_class (stale but better than 0)
    //   GREATEST picks whichever is larger so a single 0 doesn't hide real data.
    const tableRows = await this.pool.query<{
      table_name: string;
      table_schema: string;
      estimated_row_count: string;
    }>(`
      SELECT
        t.table_name,
        t.table_schema,
        GREATEST(
          COALESCE(s.n_live_tup, 0),
          COALESCE(c.reltuples::bigint, 0)
        )::text AS estimated_row_count
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s
        ON s.relname = t.table_name AND s.schemaname = t.table_schema
      LEFT JOIN pg_class c
        ON c.relname = t.table_name
       AND c.relnamespace = (
             SELECT oid FROM pg_namespace WHERE nspname = t.table_schema
           )
      WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_schema, t.table_name
    `);

    const columnRows = await this.pool.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(`
      SELECT table_schema, table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name, ordinal_position
    `);

    const pkRows = await this.pool.query<{ table_schema: string; table_name: string; column_name: string }>(`
      SELECT ku.table_schema, ku.table_name, ku.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage ku
        ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    `);

    const fkRows = await this.pool.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
      foreign_table_schema: string;
      foreign_table_name: string;
      foreign_column_name: string;
      constraint_name: string;
    }>(`
      SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    `);

    const pkSet = new Set(
      pkRows.rows.map(r => `${r.table_schema}.${r.table_name}.${r.column_name}`)
    );

    const fkMap = new Map<string, { refTable: string; refCol: string }>();
    for (const r of fkRows.rows) {
      fkMap.set(
        `${r.table_schema}.${r.table_name}.${r.column_name}`,
        { refTable: `${r.foreign_table_schema}.${r.foreign_table_name}`, refCol: r.foreign_column_name }
      );
    }

    // Group columns by table
    const columnsByTable = new Map<string, ColumnInfo[]>();
    for (const r of columnRows.rows) {
      const key = `${r.table_schema}.${r.table_name}`;
      if (!columnsByTable.has(key)) columnsByTable.set(key, []);
      const fkInfo = fkMap.get(`${r.table_schema}.${r.table_name}.${r.column_name}`);
      columnsByTable.get(key)!.push({
        name: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable === 'YES',
        isPrimaryKey: pkSet.has(`${r.table_schema}.${r.table_name}.${r.column_name}`),
        isForeignKey: !!fkInfo,
        referencesTable: fkInfo?.refTable,
        referencesColumn: fkInfo?.refCol,
      });
    }

    const nodes: Omit<GraphNode, 'metrics'>[] = tableRows.rows.map(r => ({
      id: `${r.table_schema}.${r.table_name}`,
      label: r.table_name,
      schema: r.table_schema,
      rowCount: parseInt(r.estimated_row_count, 10) || 0,
      columns: columnsByTable.get(`${r.table_schema}.${r.table_name}`) ?? [],
    }));

    const edges: GraphEdge[] = fkRows.rows.map(r => ({
      id: r.constraint_name,
      source: `${r.table_schema}.${r.table_name}`,
      target: `${r.foreign_table_schema}.${r.foreign_table_name}`,
      sourceColumn: r.column_name,
      targetColumn: r.foreign_column_name,
    }));

    return { nodes, edges };
  }

  async querySample(schema: string, table: string): Promise<Record<string, unknown>[]> {
    if (!this.pool) return [];
    const safeSchema = schema.replace(/[^a-zA-Z0-9_]/g, '');
    const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
    const result = await this.pool.query(
      `SELECT * FROM "${safeSchema}"."${safeTable}" LIMIT 10`
    );
    return result.rows as Record<string, unknown>[];
  }

  async getLiveStats(): Promise<LiveStats> {
    if (!this.pool) return { activities: [], tableQueryCounts: {} };

    const result = await this.pool.query<{
      pid: string;
      query: string;
      state: string;
      query_start: Date | null;
      wait_event_type: string | null;
    }>(`
      SELECT
        pid::text,
        COALESCE(query, '') AS query,
        COALESCE(state, 'unknown') AS state,
        query_start,
        wait_event_type
      FROM pg_stat_activity
      WHERE state != 'idle'
        AND pid != pg_backend_pid()
        AND query NOT LIKE '%pg_stat_activity%'
      LIMIT 100
    `);

    const tableQueryCounts: Record<string, number> = {};
    const activities: ActivityEvent[] = result.rows.map(row => {
      const tables = extractTableNames(row.query);
      tables.forEach(t => {
        tableQueryCounts[t] = (tableQueryCounts[t] ?? 0) + 1;
      });
      return {
        id: row.pid,
        queryText: row.query.slice(0, 200),
        sourceTables: tables,
        state: row.state,
        durationMs: row.query_start
          ? Date.now() - row.query_start.getTime()
          : undefined,
        timestamp: Date.now(),
      };
    });

    return { activities, tableQueryCounts };
  }
}

/** Best-effort regex extraction of table names from a SQL query */
function extractTableNames(sql: string): string[] {
  const normalized = sql.toLowerCase().replace(/\s+/g, ' ');
  const tables: string[] = [];
  const patterns = [
    /from\s+(?:"?(\w+)"?\.)?"?(\w+)"?/g,
    /join\s+(?:"?(\w+)"?\.)?"?(\w+)"?\s+(?:as\s+\w+\s+)?on/g,
    /update\s+(?:"?(\w+)"?\.)?"?(\w+)"?\s+set/g,
    /insert\s+into\s+(?:"?(\w+)"?\.)?"?(\w+)"?/g,
    /delete\s+from\s+(?:"?(\w+)"?\.)?"?(\w+)"?/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      const name = match[2] ?? match[1];
      if (name && !SQL_KEYWORDS.has(name)) tables.push(name);
    }
  }
  return [...new Set(tables)];
}

const SQL_KEYWORDS = new Set([
  'select', 'where', 'and', 'or', 'not', 'in', 'is', 'null', 'true', 'false',
  'as', 'on', 'using', 'left', 'right', 'inner', 'outer', 'cross', 'full',
  'values', 'set', 'returning', 'limit', 'offset', 'order', 'by', 'group',
  'having', 'union', 'intersect', 'except', 'all', 'distinct', 'case', 'when',
  'then', 'else', 'end', 'with', 'recursive',
]);
