import http from 'http';
import express from 'express';
import cors from 'cors';
import type { WebSocketServer } from 'ws';
import { createWsServer, broadcast } from './ws/server';
import { createConnector } from '@db-cosmos/connectors';
import type { DBConnector } from '@db-cosmos/connectors';
import { SQLiteConnector } from '@db-cosmos/connectors';
import { PostgresConnector } from '@db-cosmos/connectors';
import { RuntimeEngine } from '@db-cosmos/engine-runtime';
import { buildGraphSnapshot, applyMetricsToSnapshot } from '@db-cosmos/engine-graph';
import type { ConnectionConfig, GraphSnapshot, ConnectionStatus } from '@db-cosmos/shared';
import { seedDemo, DEMO_HOT_TABLES, DEMO_COLD_TABLES } from './demo/seed';
import type { ActivityEvent } from '@db-cosmos/shared';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

// ── Demo DB connection params (overridable via env) ───────────────────────────

// Pagila (movie rental) — port 5433
const DEMO_PAGILA_HOST     = process.env.DEMO_PG_HOST     ?? process.env.DEMO_PAGILA_HOST     ?? 'localhost';
const DEMO_PAGILA_PORT     = parseInt(process.env.DEMO_PG_PORT ?? process.env.DEMO_PAGILA_PORT ?? '5433', 10);
const DEMO_PAGILA_DB       = process.env.DEMO_PG_DB       ?? process.env.DEMO_PAGILA_DB       ?? 'pagila';
const DEMO_PAGILA_USER     = process.env.DEMO_PG_USER     ?? process.env.DEMO_PAGILA_USER     ?? 'pagila';
const DEMO_PAGILA_PASSWORD = process.env.DEMO_PG_PASSWORD ?? process.env.DEMO_PAGILA_PASSWORD ?? 'pagila';

// Northwind (trading company) — port 5434
const DEMO_NW_HOST     = process.env.DEMO_NW_HOST     ?? 'localhost';
const DEMO_NW_PORT     = parseInt(process.env.DEMO_NW_PORT     ?? '5434', 10);
const DEMO_NW_DB       = process.env.DEMO_NW_DB       ?? 'northwind';
const DEMO_NW_USER     = process.env.DEMO_NW_USER     ?? 'northwind';
const DEMO_NW_PASSWORD = process.env.DEMO_NW_PASSWORD ?? 'northwind';

// ── State ─────────────────────────────────────────────────────────────────────

let connector: DBConnector | null = null;
let runtime: RuntimeEngine | null = null;
let currentSnapshot: GraphSnapshot | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let demoInterval: ReturnType<typeof setInterval> | null = null;
let connectionStatus: ConnectionStatus = { connected: false, driver: 'none' };
let isDemoMode = false;
/** Current poll interval in ms — adjustable at runtime via WS set_poll_interval */
let currentPollIntervalMs = 1000;
const POLL_INTERVAL_MIN_MS = 500;
const POLL_INTERVAL_MAX_MS = 10_000;

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/api/status', (_req, res) => {
  res.json(connectionStatus);
});

app.post('/api/connect', async (req, res) => {
  const body = req.body as { demo?: boolean; demoDb?: 'pagila' | 'northwind' } & ConnectionConfig;

  try {
    await teardown();

    if (body.demo) {
      await startDemoMode(body.demoDb ?? 'pagila');
    } else {
      await startConnection(body);
    }

    res.json({ ok: true, status: connectionStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api] connect error:', message);
    connectionStatus = { connected: false, driver: 'none', error: message };
    broadcast(wss, { type: 'connection_status', payload: connectionStatus });
    res.status(500).json({ ok: false, error: message });
  }
});

app.post('/api/disconnect', async (_req, res) => {
  await teardown();
  res.json({ ok: true });
});

/** Return up to 10 sample rows for a given table (read-only, safe) */
app.get('/api/table-sample', async (req, res) => {
  const tableId = String(req.query.tableId ?? '');
  if (!tableId || !connector) {
    return res.status(400).json({ error: 'No active connection or missing tableId' });
  }
  const parts = tableId.split('.');
  const schema = parts.length > 1 ? parts[0] : 'public';
  const table  = parts[parts.length - 1];

  try {
    const rows = await connector.querySample(schema, table);
    return res.json({ rows });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── HTTP + WS server ──────────────────────────────────────────────────────────

const httpServer = http.createServer(app);
const wss: WebSocketServer = createWsServer(httpServer);

wss.on('connection', (ws) => {
  const sendMsg = (msg: object) => ws.send(JSON.stringify(msg));
  sendMsg({ type: 'connection_status', payload: connectionStatus });
  if (currentSnapshot) {
    sendMsg({ type: 'graph_snapshot', payload: currentSnapshot });
  }

  // Handle client → server messages
  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as { type: string; payload: unknown };
      if (msg.type === 'set_poll_interval') {
        const raw = (msg.payload as { intervalMs?: unknown }).intervalMs;
        if (typeof raw !== 'number') return;
        const clamped = Math.max(POLL_INTERVAL_MIN_MS, Math.min(POLL_INTERVAL_MAX_MS, raw));
        currentPollIntervalMs = clamped;
        // Restart the active poll loop with the new interval
        if (connector && runtime && currentSnapshot) {
          startPolling(clamped);
        }
        console.log(`[poll] interval set to ${clamped}ms`);
      }
    } catch {
      // ignore malformed messages
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[db-cosmos] backend running on http://localhost:${PORT}`);
  console.log(`[db-cosmos] WebSocket endpoint: ws://localhost:${PORT}/ws`);

  // Auto-start Pagila demo on launch (falls back to SQLite)
  startDemoMode('pagila').catch(err => {
    console.error('[demo] failed to start demo mode on launch:', err);
  });
});

// ── Connection lifecycle ──────────────────────────────────────────────────────

async function startConnection(config: ConnectionConfig): Promise<void> {
  connector = createConnector(config);
  await connector.connect();

  runtime = new RuntimeEngine();
  const introspection = await connector.introspect();
  currentSnapshot = buildGraphSnapshot(introspection);

  for (const node of currentSnapshot.nodes) {
    runtime.initTable(node.id, node.rowCount, node.metrics.relationDensity);
  }

  connectionStatus = {
    connected: true,
    driver: config.driver,
    database: config.database,
    nodeCount: currentSnapshot.nodes.length,
    edgeCount: currentSnapshot.edges.length,
  };

  broadcast(wss, { type: 'connection_status', payload: connectionStatus });
  broadcast(wss, { type: 'graph_snapshot', payload: currentSnapshot });

  startPolling();
  isDemoMode = false;
  console.log(`[db-cosmos] connected to ${config.driver}:${config.database} — ${currentSnapshot.nodes.length} tables`);
}

async function startDemoMode(demoDb: 'pagila' | 'northwind' = 'pagila'): Promise<void> {
  isDemoMode = true;

  if (demoDb === 'northwind') {
    try {
      await startNorthwindDemo();
      return;
    } catch (err) {
      console.warn('[demo] Northwind Postgres unavailable:', err instanceof Error ? err.message : err);
      console.warn('[demo] Falling back to SQLite demo…');
    }
  } else {
    // Pagila first
    try {
      await startPagilaDemo();
      return;
    } catch (err) {
      console.warn('[demo] Pagila Postgres unavailable:', err instanceof Error ? err.message : err);
      console.warn('[demo] Falling back to SQLite demo…');
    }
  }

  // Final fallback: in-memory SQLite
  await startSqliteDemo(true);
}

async function startPagilaDemo(): Promise<void> {
  const pgConnector = new PostgresConnector({
    driver: 'postgres',
    host: DEMO_PAGILA_HOST,
    port: DEMO_PAGILA_PORT,
    database: DEMO_PAGILA_DB,
    user: DEMO_PAGILA_USER,
    password: DEMO_PAGILA_PASSWORD,
  });

  await pgConnector.connect();

  // ANALYZE refreshes n_live_tup in pg_stat_user_tables so row counts are accurate
  // on a freshly initialised container (autovacuum hasn't run yet).
  console.log('[demo] running ANALYZE on Pagila…');
  await pgConnector.analyze();

  connector = pgConnector;
  runtime = new RuntimeEngine();
  const introspection = await connector.introspect();
  currentSnapshot = buildGraphSnapshot(introspection);

  for (const node of currentSnapshot.nodes) {
    runtime.initTable(node.id, node.rowCount, node.metrics.relationDensity);
  }

  connectionStatus = {
    connected: true,
    driver: 'postgres',
    database: `${DEMO_PAGILA_HOST}:${DEMO_PAGILA_PORT}/${DEMO_PAGILA_DB} (Pagila demo)`,
    nodeCount: currentSnapshot.nodes.length,
    edgeCount: currentSnapshot.edges.length,
  };

  broadcast(wss, { type: 'connection_status', payload: connectionStatus });
  broadcast(wss, { type: 'graph_snapshot', payload: currentSnapshot });

  startPolling();
  startPagilaDemoActivitySimulator(pgConnector);

  console.log(`[db-cosmos] Pagila demo active — ${currentSnapshot.nodes.length} tables`);
}

async function startNorthwindDemo(): Promise<void> {
  const pgConnector = new PostgresConnector({
    driver: 'postgres',
    host: DEMO_NW_HOST,
    port: DEMO_NW_PORT,
    database: DEMO_NW_DB,
    user: DEMO_NW_USER,
    password: DEMO_NW_PASSWORD,
  });

  await pgConnector.connect();

  // Refresh row-count statistics (critical for fresh containers)
  console.log('[demo] running ANALYZE on Northwind…');
  await pgConnector.analyze();

  connector = pgConnector;
  runtime = new RuntimeEngine();
  const introspection = await connector.introspect();
  currentSnapshot = buildGraphSnapshot(introspection);

  for (const node of currentSnapshot.nodes) {
    runtime.initTable(node.id, node.rowCount, node.metrics.relationDensity);
  }

  connectionStatus = {
    connected: true,
    driver: 'postgres',
    database: `${DEMO_NW_HOST}:${DEMO_NW_PORT}/${DEMO_NW_DB} (Northwind demo)`,
    nodeCount: currentSnapshot.nodes.length,
    edgeCount: currentSnapshot.edges.length,
  };

  broadcast(wss, { type: 'connection_status', payload: connectionStatus });
  broadcast(wss, { type: 'graph_snapshot', payload: currentSnapshot });

  startPolling();
  startNorthwindDemoActivitySimulator(pgConnector);

  console.log(`[db-cosmos] Northwind demo active — ${currentSnapshot.nodes.length} tables`);
}

async function startSqliteDemo(demoFallback = false): Promise<void> {
  const sqliteConnector = new SQLiteConnector({ driver: 'sqlite', database: ':memory:' });
  connector = sqliteConnector;
  await connector.connect();

  seedDemo(sqliteConnector.getDatabase());

  runtime = new RuntimeEngine();
  const introspection = await connector.introspect();
  currentSnapshot = buildGraphSnapshot(introspection);

  for (const node of currentSnapshot.nodes) {
    runtime.initTable(node.id, node.rowCount, node.metrics.relationDensity);
  }

  connectionStatus = {
    connected: true,
    driver: 'sqlite',
    database: ':memory: (SQLite demo)',
    nodeCount: currentSnapshot.nodes.length,
    edgeCount: currentSnapshot.edges.length,
    demoFallback,
  };

  broadcast(wss, { type: 'connection_status', payload: connectionStatus });
  broadcast(wss, { type: 'graph_snapshot', payload: currentSnapshot });

  startPolling();
  startDemoActivitySimulator(sqliteConnector);

  const label = demoFallback
    ? 'SQLite fallback demo (Docker/Postgres unavailable)'
    : 'SQLite demo — StackOverflow-style schema loaded';
  console.log(`[db-cosmos] ${label}`);
}

async function teardown(): Promise<void> {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (demoInterval) { clearInterval(demoInterval); demoInterval = null; }
  if (connector) {
    try { await connector.disconnect(); } catch { /* best effort */ }
    connector = null;
  }
  runtime = null;
  currentSnapshot = null;
  isDemoMode = false;
  connectionStatus = { connected: false, driver: 'none' };
  broadcast(wss, { type: 'connection_status', payload: connectionStatus });
}

// ── Polling loop ──────────────────────────────────────────────────────────────

function startPolling(intervalMs = currentPollIntervalMs): void {
  currentPollIntervalMs = Math.max(POLL_INTERVAL_MIN_MS, Math.min(POLL_INTERVAL_MAX_MS, intervalMs));
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    if (!connector || !runtime || !currentSnapshot) return;

    try {
      const stats = await connector.getLiveStats();
      const metrics = runtime.tick(stats.tableQueryCounts, stats.activities);

      currentSnapshot = applyMetricsToSnapshot(currentSnapshot, metrics);

      broadcast(wss, {
        type: 'metrics_update',
        payload: { tableMetrics: metrics, timestamp: Date.now() },
      });

      if (stats.activities.length > 0) {
        broadcast(wss, { type: 'activity_update', payload: stats.activities });
      }
    } catch (err) {
      console.error('[poll] error:', err instanceof Error ? err.message : err);
    }
  }, 1000);
}

// ── Pagila demo activity simulator ───────────────────────────────────────────

function startPagilaDemoActivitySimulator(pgConnector: typeof connector): void {
  if (demoInterval) clearInterval(demoInterval);

  const pagilaQueries: Array<{ tables: string[]; state: string }> = [
    { tables: ['rental', 'inventory', 'film'], state: 'active' },
    { tables: ['payment', 'customer'], state: 'active' },
    { tables: ['film', 'film_actor', 'actor'], state: 'active' },
    { tables: ['customer', 'rental'], state: 'active' },
    { tables: ['film', 'film_category', 'category'], state: 'active' },
    { tables: ['inventory', 'store'], state: 'idle' },
    { tables: ['staff', 'store'], state: 'idle' },
    { tables: ['rental'], state: 'active' },
    { tables: ['payment'], state: 'active' },
    { tables: ['film', 'language'], state: 'idle' },
  ];

  const HOT = ['rental', 'payment', 'customer', 'film', 'inventory'];
  let tick = 0;

  demoInterval = setInterval(() => {
    tick++;
    const numEvents = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numEvents; i++) {
      const q = pagilaQueries[Math.floor(Math.random() * pagilaQueries.length)];
      void pgConnector;
      const event: ActivityEvent = {
        id: `pagila-${tick}-${i}`,
        queryText: `SELECT ... FROM ${q.tables.join(', ')} ...`,
        sourceTables: q.tables,
        state: q.state,
        durationMs: Math.floor(Math.random() * 15),
        timestamp: Date.now(),
      };
      const counts: Record<string, number> = {};
      for (const t of q.tables) counts[t] = (counts[t] ?? 0) + 1;
      if (runtime) {
        runtime.tick(counts, [event]);
        if (currentSnapshot) {
          currentSnapshot = applyMetricsToSnapshot(currentSnapshot, runtime.tick({}, []));
        }
      }
      broadcast(wss, { type: 'activity_update', payload: [event] });
    }

    if (tick % 5 === 0) {
      const burstTable = HOT[Math.floor(Math.random() * HOT.length)];
      const burstEvent: ActivityEvent = {
        id: `burst-${tick}`,
        queryText: `SELECT * FROM ${burstTable} LIMIT 50`,
        sourceTables: [burstTable],
        state: 'active',
        durationMs: 0,
        timestamp: Date.now(),
      };
      broadcast(wss, { type: 'activity_update', payload: [burstEvent] });
    }
  }, 800);
}

// ── Northwind demo activity simulator ────────────────────────────────────────

function startNorthwindDemoActivitySimulator(pgConnector: typeof connector): void {
  if (demoInterval) clearInterval(demoInterval);

  const northwindQueries: Array<{ tables: string[]; state: string }> = [
    { tables: ['orders', 'order_details', 'products'], state: 'active' },
    { tables: ['customers', 'orders'], state: 'active' },
    { tables: ['products', 'categories', 'suppliers'], state: 'active' },
    { tables: ['employees', 'orders'], state: 'active' },
    { tables: ['order_details', 'products'], state: 'active' },
    { tables: ['customers'], state: 'active' },
    { tables: ['products', 'suppliers'], state: 'idle' },
    { tables: ['orders', 'shippers'], state: 'idle' },
    { tables: ['employees', 'territories', 'region'], state: 'idle' },
    { tables: ['order_details', 'orders', 'customers', 'employees'], state: 'active' },
  ];

  const HOT = ['orders', 'order_details', 'customers', 'products', 'employees'];
  let tick = 0;

  demoInterval = setInterval(() => {
    tick++;
    void pgConnector;
    const numEvents = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numEvents; i++) {
      const q = northwindQueries[Math.floor(Math.random() * northwindQueries.length)];
      const event: ActivityEvent = {
        id: `nw-${tick}-${i}`,
        queryText: `SELECT ... FROM ${q.tables.join(', ')} ...`,
        sourceTables: q.tables,
        state: q.state,
        durationMs: Math.floor(Math.random() * 12),
        timestamp: Date.now(),
      };
      const counts: Record<string, number> = {};
      for (const t of q.tables) counts[t] = (counts[t] ?? 0) + 1;
      if (runtime) {
        runtime.tick(counts, [event]);
        if (currentSnapshot) {
          currentSnapshot = applyMetricsToSnapshot(currentSnapshot, runtime.tick({}, []));
        }
      }
      broadcast(wss, { type: 'activity_update', payload: [event] });
    }

    if (tick % 5 === 0) {
      const burstTable = HOT[Math.floor(Math.random() * HOT.length)];
      const burstEvent: ActivityEvent = {
        id: `nw-burst-${tick}`,
        queryText: `SELECT * FROM ${burstTable} LIMIT 50`,
        sourceTables: [burstTable],
        state: 'active',
        durationMs: 0,
        timestamp: Date.now(),
      };
      broadcast(wss, { type: 'activity_update', payload: [burstEvent] });
    }
  }, 800);
}

// ── SQLite demo activity simulator ───────────────────────────────────────────

function startDemoActivitySimulator(sqliteConnector: SQLiteConnector): void {
  if (demoInterval) clearInterval(demoInterval);

  const db = sqliteConnector.getDatabase();

  const demoQueries: Array<{ sql: string; tables: string[] }> = [
    { sql: 'SELECT COUNT(*) FROM questions', tables: ['questions'] },
    { sql: 'SELECT * FROM answers LIMIT 10', tables: ['answers'] },
    { sql: 'SELECT u.username, COUNT(q.id) FROM users u JOIN questions q ON q.user_id = u.id GROUP BY u.id', tables: ['users', 'questions'] },
    { sql: 'SELECT * FROM votes WHERE post_type = \'question\' LIMIT 20', tables: ['votes'] },
    { sql: 'SELECT q.title, t.name FROM questions q JOIN question_tags qt ON qt.question_id = q.id JOIN tags t ON t.id = qt.tag_id LIMIT 15', tables: ['questions', 'question_tags', 'tags'] },
    { sql: 'SELECT * FROM comments ORDER BY created_at DESC LIMIT 5', tables: ['comments'] },
    { sql: 'SELECT u.username, b.name FROM user_badges ub JOIN users u ON u.id = ub.user_id JOIN badges b ON b.id = ub.badge_id', tables: ['user_badges', 'users', 'badges'] },
    { sql: 'SELECT answer_count, view_count FROM questions WHERE score > 5', tables: ['questions'] },
    { sql: 'SELECT * FROM answers WHERE is_accepted = 1 LIMIT 10', tables: ['answers'] },
    { sql: 'SELECT COUNT(*) FROM votes GROUP BY post_type', tables: ['votes'] },
  ];

  let tick = 0;

  demoInterval = setInterval(() => {
    tick++;
    const numQueries = 2 + Math.floor(Math.random() * 4);
    const hotBias = Math.random() < 0.7;

    for (let i = 0; i < numQueries; i++) {
      const query = hotBias
        ? demoQueries[Math.floor(Math.random() * 5)]
        : demoQueries[Math.floor(Math.random() * demoQueries.length)];

      try {
        db.prepare(query.sql).all();
        const event: ActivityEvent = {
          id: `demo-${tick}-${i}`,
          queryText: query.sql,
          sourceTables: query.tables,
          state: 'active',
          durationMs: Math.floor(Math.random() * 8),
          timestamp: Date.now(),
        };
        sqliteConnector.recordActivity(event);
      } catch {
        // ignore demo query errors
      }
    }

    if (tick % 5 === 0) {
      const burstTable = DEMO_HOT_TABLES[Math.floor(Math.random() * DEMO_HOT_TABLES.length)];
      for (let b = 0; b < 8; b++) {
        sqliteConnector.recordActivity({
          id: `burst-${tick}-${b}`,
          queryText: `SELECT * FROM ${burstTable} LIMIT ${b + 1}`,
          sourceTables: [burstTable],
          state: 'active',
          durationMs: b * 2,
          timestamp: Date.now(),
        });
      }
    }

    if (tick % 12 === 0) {
      void DEMO_COLD_TABLES[Math.floor(Math.random() * DEMO_COLD_TABLES.length)];
    }
  }, 800);
}
