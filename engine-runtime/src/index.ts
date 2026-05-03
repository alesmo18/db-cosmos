import type { TableMetrics, ActivityEvent } from '@db-cosmos/shared';

const WINDOW_MS = 10_000; // 10-second rolling window

interface TableState {
  rowCount: number;
  relationDensity: number;
  /** timestamps of recent query hits */
  queryTimestamps: number[];
  activeQueries: number;
}

/**
 * RuntimeEngine maintains rolling metrics for each table.
 * Call `tick()` once per poll interval with fresh data.
 */
export class RuntimeEngine {
  private readonly tables = new Map<string, TableState>();

  /** Initialise table baseline from graph snapshot data */
  initTable(id: string, rowCount: number, relationDensity: number): void {
    if (!this.tables.has(id)) {
      this.tables.set(id, {
        rowCount,
        relationDensity,
        queryTimestamps: [],
        activeQueries: 0,
      });
    } else {
      const state = this.tables.get(id)!;
      state.rowCount = rowCount;
      state.relationDensity = relationDensity;
    }
  }

  /**
   * Ingest a poll cycle: new query-count deltas + activity events.
   * Returns updated metrics for all known tables.
   */
  tick(
    queryCounts: Record<string, number>,
    activities: ActivityEvent[],
    rowCounts?: Record<string, number>
  ): Record<string, TableMetrics> {
    const now = Date.now();

    // Track active queries per table from activity events
    const activeByTable = new Map<string, number>();
    for (const ev of activities) {
      for (const t of ev.sourceTables) {
        activeByTable.set(t, (activeByTable.get(t) ?? 0) + 1);
      }
    }

    // Stamp new query hits from the delta counts
    for (const [table, count] of Object.entries(queryCounts)) {
      if (!this.tables.has(table)) {
        this.tables.set(table, {
          rowCount: rowCounts?.[table] ?? 0,
          relationDensity: 0,
          queryTimestamps: [],
          activeQueries: 0,
        });
      }
      const state = this.tables.get(table)!;
      for (let i = 0; i < count; i++) state.queryTimestamps.push(now);
    }

    // Update row counts and active queries
    for (const [id, state] of this.tables.entries()) {
      if (rowCounts?.[id] !== undefined) state.rowCount = rowCounts[id];
      state.activeQueries = activeByTable.get(id.split('.').pop() ?? id) ?? 0;
    }

    // Compute metrics for each table
    const result: Record<string, TableMetrics> = {};
    for (const [id, state] of this.tables.entries()) {
      // Evict timestamps older than window
      const cutoff = now - WINDOW_MS;
      const startIdx = state.queryTimestamps.findIndex(t => t >= cutoff);
      if (startIdx > 0) state.queryTimestamps = state.queryTimestamps.slice(startIdx);
      else if (startIdx === -1) state.queryTimestamps = [];

      const queryFrequency = state.queryTimestamps.length / (WINDOW_MS / 1000);
      const accessRate = queryFrequency + state.activeQueries;
      const hotspotScore = computeHotspot(queryFrequency, state.activeQueries, state.relationDensity);

      result[id] = {
        queryFrequency: round(queryFrequency),
        rowCount: state.rowCount,
        relationDensity: state.relationDensity,
        accessRate: round(accessRate),
        hotspotScore: round(hotspotScore),
        activeQueries: state.activeQueries,
      };
    }

    return result;
  }

  getMetrics(id: string): TableMetrics | undefined {
    const state = this.tables.get(id);
    if (!state) return undefined;
    return {
      queryFrequency: 0,
      rowCount: state.rowCount,
      relationDensity: state.relationDensity,
      accessRate: 0,
      hotspotScore: 0,
      activeQueries: state.activeQueries,
    };
  }
}

/**
 * Composite hotspot score in [0, 1].
 * Weights: active queries (most immediate) > query frequency > relation density.
 */
function computeHotspot(
  queryFreq: number,
  activeQueries: number,
  relationDensity: number
): number {
  const freqScore = Math.min(queryFreq / 10, 1);            // saturates at 10 qps
  const activeScore = Math.min(activeQueries / 5, 1);       // saturates at 5 concurrent
  const densityScore = Math.min(relationDensity / 10, 1);   // saturates at 10 relations

  return freqScore * 0.5 + activeScore * 0.4 + densityScore * 0.1;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
