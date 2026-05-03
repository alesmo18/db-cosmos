import React, { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCosmosStore } from '../store';
import { hotspotHex, classifyTableRole } from '@db-cosmos/engine-visual';
import type { GraphNode, ColumnInfo } from '@db-cosmos/shared';

// ── Shared sub-components ────────────────────────────────────────────────────

function HotspotBar({ score }: { score: number }): React.ReactElement {
  return (
    <div className="relative h-1.5 rounded-full overflow-hidden bg-cosmos-surface mt-1">
      <div className="hotspot-bar h-full rounded-full" style={{ width: '100%' }} />
      <div
        className="absolute top-0 right-0 h-full bg-cosmos-bg rounded-full"
        style={{ width: `${(1 - score) * 100}%` }}
      />
    </div>
  );
}

function MetricRow({
  label,
  value,
  unit = '',
}: {
  label: string;
  value: string | number;
  unit?: string;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between py-1 border-b border-cosmos-border/30">
      <span className="text-cosmos-muted text-xs uppercase tracking-widest">{label}</span>
      <span className="font-mono text-xs text-cosmos-text">
        {value}
        <span className="text-cosmos-muted ml-0.5">{unit}</span>
      </span>
    </div>
  );
}

function ColumnRow({ col }: { col: ColumnInfo }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="flex-1 font-mono text-xs text-cosmos-text truncate">{col.name}</span>
      <span className="font-mono text-xs text-cosmos-muted">{col.type}</span>
      <div className="flex gap-1">
        {col.isPrimaryKey && (
          <span className="text-[9px] bg-yellow-900/40 text-yellow-400 px-1 rounded">PK</span>
        )}
        {col.isForeignKey && (
          <span className="text-[9px] bg-blue-900/40 text-cosmos-accent px-1 rounded">FK</span>
        )}
      </div>
    </div>
  );
}

// ── Sample data helpers ──────────────────────────────────────────────────────

type ValueKind = 'null' | 'number' | 'boolean_true' | 'boolean_false' | 'date' | 'text';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+\-]+)?$/;
const DATE_COL_RE = /_(at|date|time|ts|stamp)$|^(created|updated|deleted|modified|timestamp)/i;
const UNIX_SEC_RE = /^\d{9,10}$/;
const UNIX_MS_RE  = /^\d{13}$/;

function detectKind(col: string, value: unknown): ValueKind {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'boolean_true' : 'boolean_false';
  if (typeof value === 'number')  return 'number';
  if (typeof value === 'string') {
    if (ISO_DATE_RE.test(value)) return 'date';
    if (DATE_COL_RE.test(col) && (UNIX_SEC_RE.test(value) || UNIX_MS_RE.test(value))) return 'date';
    const n = Number(value);
    if (value.trim() !== '' && !isNaN(n)) return 'number';
  }
  return 'text';
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(raw: unknown): string {
  try {
    const str = String(raw);
    let ts: number;
    if (UNIX_SEC_RE.test(str)) {
      ts = parseInt(str, 10) * 1000;
    } else if (UNIX_MS_RE.test(str)) {
      ts = parseInt(str, 10);
    } else {
      ts = Date.parse(str);
    }
    if (isNaN(ts)) return str;
    const d = new Date(ts);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  } catch {
    return String(raw);
  }
}

/** Sort columns: id cols first → short names (≤6) → rest, both groups alphabetical */
function sortColumns(cols: string[]): string[] {
  const isId    = (c: string) => /^id$|_id$|^id_/i.test(c);
  const isShort = (c: string) => c.length <= 6 && !isId(c);
  return [
    ...cols.filter(isId).sort(),
    ...cols.filter(isShort).sort(),
    ...cols.filter(c => !isId(c) && !isShort(c)).sort(),
  ];
}

const LONG_VALUE_THRESHOLD = 90;

// ── FieldChip ────────────────────────────────────────────────────────────────

interface FieldChipProps {
  col: string;
  value: unknown;
  expandKey: string;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}

function FieldChip({ col, value, expandKey, expanded, onToggle }: FieldChipProps): React.ReactElement {
  const kind    = detectKind(col, value);
  const isExpanded = expanded.has(expandKey);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(String(value ?? '')).catch(() => { /* best effort */ });
  };

  // Null
  if (kind === 'null') {
    return (
      <div className="bg-cosmos-surface/30 rounded-md p-2 flex flex-col min-h-[42px]">
        <span className="text-[9px] text-cosmos-muted/70 uppercase tracking-widest truncate mb-1">{col}</span>
        <span className="text-[10px] text-cosmos-muted/50 italic select-none">∅ null</span>
      </div>
    );
  }

  // Boolean
  if (kind === 'boolean_true' || kind === 'boolean_false') {
    return (
      <div className="bg-cosmos-surface/30 rounded-md p-2 flex flex-col min-h-[42px]">
        <span className="text-[9px] text-cosmos-muted/70 uppercase tracking-widest truncate mb-1">{col}</span>
        <span className={`text-[11px] font-mono font-medium ${kind === 'boolean_true' ? 'text-emerald-400' : 'text-red-400/80'}`}>
          {kind === 'boolean_true' ? 'true' : 'false'}
        </span>
      </div>
    );
  }

  // Number
  if (kind === 'number') {
    return (
      <div className="bg-cosmos-surface/30 rounded-md p-2 flex flex-col min-h-[42px]">
        <span className="text-[9px] text-cosmos-muted/70 uppercase tracking-widest truncate mb-1">{col}</span>
        <span className="text-[11px] font-mono text-sky-300 tabular-nums text-right block">{String(value)}</span>
      </div>
    );
  }

  // Date
  if (kind === 'date') {
    return (
      <div className="bg-cosmos-surface/30 rounded-md p-2 flex flex-col min-h-[42px]">
        <span className="text-[9px] text-cosmos-muted/70 uppercase tracking-widest truncate mb-1">{col}</span>
        <span className="text-[10px] font-mono text-violet-300/90">{fmtDate(value)}</span>
      </div>
    );
  }

  // Text — possibly long
  const str   = String(value);
  const isLong = str.length > LONG_VALUE_THRESHOLD;

  return (
    <div className="bg-cosmos-surface/30 rounded-md p-2 flex flex-col min-h-[42px]">
      <span className="text-[9px] text-cosmos-muted/70 uppercase tracking-widest truncate mb-1">{col}</span>
      {isLong ? (
        <div>
          <span
            className={`text-[11px] font-mono text-cosmos-text/85 break-all block ${isExpanded ? '' : 'line-clamp-3'}`}
          >
            {str}
          </span>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => onToggle(expandKey)}
              className="text-[9px] text-cosmos-muted hover:text-cosmos-accent font-mono transition-colors"
            >
              {isExpanded ? '▲ collapse' : '▼ expand'}
            </button>
            <button
              onClick={handleCopy}
              className="text-[9px] text-cosmos-muted hover:text-cosmos-accent font-mono transition-colors"
            >
              ⎘ copy
            </button>
          </div>
        </div>
      ) : (
        <span className="text-[11px] font-mono text-cosmos-text/85 break-words">{str}</span>
      )}
    </div>
  );
}

// ── SampleCards ──────────────────────────────────────────────────────────────

interface SampleCardsProps {
  rows: Record<string, unknown>[];
}

function SampleCards({ rows }: SampleCardsProps): React.ReactElement {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewJson, setViewJson]   = useState(false);

  const toggle = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  if (rows.length === 0) {
    return <p className="text-xs text-cosmos-muted italic">No rows returned</p>;
  }

  const columns = sortColumns(Object.keys(rows[0]));

  if (viewJson) {
    return (
      <div>
        <div className="flex justify-end mb-1.5">
          <button
            onClick={() => setViewJson(false)}
            className="text-[10px] text-cosmos-muted hover:text-cosmos-accent font-mono transition-colors"
          >
            ← cards
          </button>
        </div>
        <pre
          className="text-[10px] font-mono text-cosmos-text/70 overflow-auto rounded-md border border-cosmos-border/25 p-2 bg-cosmos-surface/25"
          style={{ maxHeight: 340, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        >
          {JSON.stringify(rows, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      {/* JSON toggle */}
      <div className="flex justify-end mb-2">
        <button
          onClick={() => setViewJson(true)}
          className="text-[10px] text-cosmos-muted hover:text-cosmos-accent font-mono transition-colors"
        >
          {'{ } JSON'}
        </button>
      </div>

      {/* Per-row cards */}
      <div className="space-y-3">
        {rows.map((row, rowIdx) => (
          <div
            key={rowIdx}
            className="rounded-lg border border-cosmos-border/30 overflow-hidden"
          >
            {/* Card header */}
            <div className="px-2.5 py-1.5 bg-cosmos-surface/50 border-b border-cosmos-border/25">
              <span className="text-[9px] font-mono text-cosmos-muted/70 uppercase tracking-widest">
                Row {rowIdx + 1}
              </span>
            </div>

            {/* 2-column chip grid */}
            <div className="p-2 grid grid-cols-2 gap-1.5">
              {columns.map(col => (
                <FieldChip
                  key={col}
                  col={col}
                  value={row[col]}
                  expandKey={`${rowIdx}-${col}`}
                  expanded={expanded}
                  onToggle={toggle}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Role badge ────────────────────────────────────────────────────────────────

const ROLE_META = {
  reference: { label: 'REF', color: 'rgba(120,160,255,0.8)', bg: 'rgba(20,30,80,0.5)'  },
  bridge:    { label: 'JXN', color: 'rgba(180,100,255,0.8)', bg: 'rgba(30,10,50,0.5)'  },
  fact:      { label: 'TXN', color: 'rgba(255,140,60,0.9)',  bg: 'rgba(60,20,5,0.5)'   },
  dimension: { label: 'DIM', color: 'rgba(0,212,255,0.8)',   bg: 'rgba(0,30,50,0.5)'   },
  unknown:   { label: 'UNK', color: 'rgba(130,140,160,0.7)', bg: 'rgba(20,25,35,0.5)'  },
} as const;

// ── Inspector ─────────────────────────────────────────────────────────────────

interface InspectorProps {
  node: GraphNode;
}

export function Inspector({ node }: InspectorProps): React.ReactElement {
  // Live metrics: subscribe only to this node's entry so Inspector re-renders
  // on poll updates without triggering GalaxyView re-renders.
  const liveMetrics   = useCosmosStore(s => s.metrics[node.id]) ?? node.metrics;
  const metrics       = liveMetrics;
  const heatColor     = hotspotHex(metrics.hotspotScore);
  const role          = classifyTableRole(node.label, node.rowCount, metrics.relationDensity);
  const roleMeta      = ROLE_META[role];

  const zoomLevel    = useCosmosStore(s => s.zoomLevel);
  const sampleRows   = useCosmosStore(s => s.sampleRows);
  const setSampleRows = useCosmosStore(s => s.setSampleRows);
  const isL3  = zoomLevel === 'L3';
  const rows  = sampleRows[node.id] ?? null;

  const lastFetchedNodeId = useRef<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const fetchSample = useCallback((nodeId: string) => {
    setIsFetching(true);
    lastFetchedNodeId.current = nodeId;
    fetch(`/api/table-sample?tableId=${encodeURIComponent(nodeId)}`)
      .then(r => r.json())
      .then((data: { rows?: Record<string, unknown>[] }) => {
        setSampleRows(nodeId, data.rows ?? []);
      })
      .catch(() => {
        setSampleRows(nodeId, []);
      })
      .finally(() => {
        setIsFetching(false);
      });
  }, [setSampleRows]);

  // Auto-fetch on L3 entry or node change
  useEffect(() => {
    if (!isL3) return;
    if (rows !== null && lastFetchedNodeId.current === node.id) return;
    fetchSample(node.id);
  }, [isL3, node.id, rows, fetchSample]);

  return (
    <motion.div
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="glass-panel absolute right-4 top-16 w-72 rounded-xl overflow-hidden shadow-2xl"
      style={{ boxShadow: `0 0 30px ${heatColor}22` }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 border-b border-cosmos-border/50"
        style={{ borderLeftWidth: 3, borderLeftColor: heatColor }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: heatColor, boxShadow: `0 0 8px ${heatColor}` }}
          />
          <span className="font-mono text-sm font-medium text-cosmos-text">{node.label}</span>
          <span
            className="text-[9px] font-mono px-1.5 py-0.5 rounded"
            style={{ color: roleMeta.color, background: roleMeta.bg }}
          >
            {roleMeta.label}
          </span>
          <span
            className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded border"
            style={{ borderColor: `${heatColor}44`, color: heatColor }}
          >
            {zoomLevel}
          </span>
        </div>
        <div className="text-xs text-cosmos-muted mt-0.5">{node.schema}</div>
      </div>

      {/* Body — scrollable */}
      <div className="p-4 space-y-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
        {/* Hotspot */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-cosmos-muted uppercase tracking-widest">Hotspot</span>
            <span className="font-mono" style={{ color: heatColor }}>
              {Math.round(metrics.hotspotScore * 100)}%
            </span>
          </div>
          <HotspotBar score={metrics.hotspotScore} />
        </div>

        {/* Metrics */}
        <div className="space-y-0">
          <MetricRow label="Rows"           value={metrics.rowCount.toLocaleString()} />
          <MetricRow label="Query freq"     value={metrics.queryFrequency.toFixed(2)} unit="qps" />
          <MetricRow label="Active queries" value={metrics.activeQueries} />
          <MetricRow label="Access rate"    value={metrics.accessRate.toFixed(2)} unit="/s" />
          <MetricRow label="Relations"      value={metrics.relationDensity} />
        </div>

        {/* Columns */}
        <div>
          <div className="text-xs text-cosmos-muted uppercase tracking-widest mb-2">
            Columns ({node.columns.length})
          </div>
          <div className="space-y-0.5 max-h-36 overflow-y-auto pr-1">
            {node.columns.map(col => (
              <ColumnRow key={col.name} col={col} />
            ))}
          </div>
        </div>

        {/* L3: Sample rows */}
        {isL3 && (
          <div>
            {/* Section header */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-cosmos-muted uppercase tracking-widest">
                Sample rows
                {rows !== null && rows.length > 0 && (
                  <span className="ml-1 normal-case text-cosmos-accent">({rows.length})</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {isFetching ? (
                  <span className="text-[10px] text-cosmos-accent animate-pulse font-mono">loading…</span>
                ) : (
                  <button
                    onClick={() => fetchSample(node.id)}
                    className="text-[10px] text-cosmos-muted hover:text-cosmos-accent font-mono transition-colors"
                    title="Refresh"
                  >
                    ↺
                  </button>
                )}
              </div>
            </div>

            {/* Content */}
            {rows === null && !isFetching && (
              <p className="text-xs text-cosmos-muted italic">No data</p>
            )}
            {rows !== null && <SampleCards rows={rows} />}
          </div>
        )}

        {/* L2 nudge */}
        {zoomLevel === 'L2' && (
          <p className="text-[10px] text-cosmos-muted/60 italic text-center">
            Zoom in further for sample rows
          </p>
        )}
      </div>
    </motion.div>
  );
}

export function InspectorPanel(): React.ReactElement | null {
  const graph          = useCosmosStore(s => s.graph);
  const selectedNodeId = useCosmosStore(s => s.selectedNodeId);
  const selectNode     = useCosmosStore(s => s.selectNode);
  const selectedNode = graph?.nodes.find(n => n.id === selectedNodeId) ?? null;

  return (
    <AnimatePresence>
      {selectedNode && (
        <div className="pointer-events-auto">
          <button
            className="absolute top-4 right-80 z-50 text-cosmos-muted hover:text-cosmos-text text-xs"
            onClick={() => selectNode(null)}
          >
            ✕ close
          </button>
          <Inspector node={selectedNode} />
        </div>
      )}
    </AnimatePresence>
  );
}
