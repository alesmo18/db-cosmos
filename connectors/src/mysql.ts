/**
 * MySQL connector.
 * Live stats: SHOW PROCESSLIST (best-effort; does not provide table-level granularity).
 * Limitation: MySQL does not expose a direct equivalent of pg_stat_activity per-table.
 * We extract table names from query text using regex.
 */
import mysql2 from 'mysql2/promise';
import type { ConnectionConfig, ColumnInfo, GraphNode, GraphEdge, ActivityEvent } from '@db-cosmos/shared';
import type { DBConnector, IntrospectionResult, LiveStats } from './types';

export class MySQLConnector implements DBConnector {
  private conn: mysql2.Connection | null = null;
  private readonly config: ConnectionConfig;
  private connected = false;

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.conn = await mysql2.createConnection({
      host: this.config.host ?? 'localhost',
      port: this.config.port ?? 3306,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      connectTimeout: 5000,
    });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.conn) {
      await this.conn.end();
      this.conn = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async introspect(): Promise<IntrospectionResult> {
    if (!this.conn) throw new Error('Not connected');

    const db = this.config.database;

    const [tableRows] = await this.conn.execute<mysql2.RowDataPacket[]>(`
      SELECT TABLE_NAME, TABLE_ROWS
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `, [db]);

    const [columnRows] = await this.conn.execute<mysql2.RowDataPacket[]>(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `, [db]);

    const [fkRows] = await this.conn.execute<mysql2.RowDataPacket[]>(`
      SELECT
        KCU.TABLE_NAME, KCU.COLUMN_NAME, KCU.CONSTRAINT_NAME,
        KCU.REFERENCED_TABLE_NAME, KCU.REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE KCU
      JOIN information_schema.TABLE_CONSTRAINTS TC
        ON KCU.CONSTRAINT_NAME = TC.CONSTRAINT_NAME
        AND KCU.TABLE_SCHEMA = TC.TABLE_SCHEMA
      WHERE TC.CONSTRAINT_TYPE = 'FOREIGN KEY'
        AND KCU.TABLE_SCHEMA = ?
    `, [db]);

    const fkSet = new Map<string, { refTable: string; refCol: string }>();
    for (const r of fkRows) {
      fkSet.set(`${r.TABLE_NAME}.${r.COLUMN_NAME}`, {
        refTable: r.REFERENCED_TABLE_NAME,
        refCol: r.REFERENCED_COLUMN_NAME,
      });
    }

    const columnsByTable = new Map<string, ColumnInfo[]>();
    for (const r of columnRows) {
      if (!columnsByTable.has(r.TABLE_NAME)) columnsByTable.set(r.TABLE_NAME, []);
      const fk = fkSet.get(`${r.TABLE_NAME}.${r.COLUMN_NAME}`);
      columnsByTable.get(r.TABLE_NAME)!.push({
        name: r.COLUMN_NAME,
        type: r.DATA_TYPE,
        nullable: r.IS_NULLABLE === 'YES',
        isPrimaryKey: r.COLUMN_KEY === 'PRI',
        isForeignKey: !!fk,
        referencesTable: fk ? `${db}.${fk.refTable}` : undefined,
        referencesColumn: fk?.refCol,
      });
    }

    const nodes: Omit<GraphNode, 'metrics'>[] = tableRows.map(r => ({
      id: `${db}.${r.TABLE_NAME}`,
      label: r.TABLE_NAME,
      schema: db,
      rowCount: r.TABLE_ROWS ?? 0,
      columns: columnsByTable.get(r.TABLE_NAME) ?? [],
    }));

    const edges: GraphEdge[] = fkRows.map(r => ({
      id: r.CONSTRAINT_NAME,
      source: `${db}.${r.TABLE_NAME}`,
      target: `${db}.${r.REFERENCED_TABLE_NAME}`,
      sourceColumn: r.COLUMN_NAME,
      targetColumn: r.REFERENCED_COLUMN_NAME,
    }));

    return { nodes, edges };
  }

  async querySample(_schema: string, table: string): Promise<Record<string, unknown>[]> {
    if (!this.conn) return [];
    const db = this.config.database;
    const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
    const [rows] = await this.conn.execute<mysql2.RowDataPacket[]>(
      `SELECT * FROM \`${db}\`.\`${safeTable}\` LIMIT 10`
    );
    return rows as Record<string, unknown>[];
  }

  async getLiveStats(): Promise<LiveStats> {
    if (!this.conn) return { activities: [], tableQueryCounts: {} };

    // SHOW PROCESSLIST gives active queries — no per-table stats without Performance Schema
    const [rows] = await this.conn.execute<mysql2.RowDataPacket[]>(`SHOW PROCESSLIST`);

    const tableQueryCounts: Record<string, number> = {};
    const activities: ActivityEvent[] = rows
      .filter(r => r.Info && r.Command !== 'Sleep')
      .map(r => {
        const query = String(r.Info ?? '');
        const tables = extractTableNames(query);
        tables.forEach(t => {
          tableQueryCounts[t] = (tableQueryCounts[t] ?? 0) + 1;
        });
        return {
          id: String(r.Id),
          queryText: query.slice(0, 200),
          sourceTables: tables,
          state: r.State ?? 'unknown',
          durationMs: r.Time ? r.Time * 1000 : undefined,
          timestamp: Date.now(),
        };
      });

    return { activities, tableQueryCounts };
  }
}

function extractTableNames(sql: string): string[] {
  const normalized = sql.toLowerCase().replace(/\s+/g, ' ');
  const tables: string[] = [];
  const patterns = [
    /from\s+`?(\w+)`?/g,
    /join\s+`?(\w+)`?/g,
    /update\s+`?(\w+)`?\s+set/g,
    /insert\s+into\s+`?(\w+)`?/g,
    /delete\s+from\s+`?(\w+)`?/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      if (match[1] && !SQL_KEYWORDS.has(match[1])) tables.push(match[1]);
    }
  }
  return [...new Set(tables)];
}

const SQL_KEYWORDS = new Set([
  'select', 'where', 'and', 'or', 'not', 'in', 'is', 'null', 'true', 'false',
  'as', 'on', 'using', 'left', 'right', 'inner', 'outer', 'cross', 'full',
  'values', 'set', 'returning', 'limit', 'offset', 'order', 'by', 'group',
]);
