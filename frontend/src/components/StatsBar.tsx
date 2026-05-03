import React from 'react';
import { useCosmosStore } from '../store';

interface StatProps {
  label: string;
  value: string | number;
  accent?: boolean;
}

function Stat({ label, value, accent = false }: StatProps): React.ReactElement {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={`font-mono text-sm font-medium ${accent ? 'text-cosmos-accent' : 'text-cosmos-text'}`}
      >
        {value}
      </span>
      <span className="text-cosmos-muted text-xs uppercase tracking-widest">{label}</span>
    </div>
  );
}

export function StatsBar(): React.ReactElement {
  const { graph, metrics, activities, fps, connectionStatus } = useCosmosStore();

  const tableCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.edges.length ?? 0;
  const totalRows = Object.values(metrics).reduce((s, m) => s + m.rowCount, 0);
  const activeQueries = Object.values(metrics).reduce((s, m) => s + m.activeQueries, 0);
  const hottestTable = Object.entries(metrics).sort(
    ([, a], [, b]) => b.hotspotScore - a.hotspotScore
  )[0];
  const hottestLabel = hottestTable
    ? (graph?.nodes.find(n => n.id === hottestTable[0])?.label ?? hottestTable[0].split('.').pop() ?? '—')
    : '—';

  return (
    <div
      className="glass-panel absolute bottom-0 left-0 right-0 h-10 flex items-center px-6 gap-8
        border-t border-cosmos-border/50"
    >
      {/* Left: DB info */}
      <div className="flex items-center gap-2">
        <div
          className={`w-1.5 h-1.5 rounded-full ${
            connectionStatus.connected ? 'bg-emerald-400' : 'bg-cosmos-muted'
          }`}
          style={connectionStatus.connected ? { boxShadow: '0 0 6px #34d399' } : {}}
        />
        <span className="font-mono text-xs text-cosmos-muted">
          {connectionStatus.connected
            ? connectionStatus.database ?? connectionStatus.driver
            : 'disconnected'}
        </span>
      </div>

      <div className="h-4 w-px bg-cosmos-border" />

      {/* Middle: stats */}
      <div className="flex items-center gap-6">
        <Stat label="tables" value={tableCount} />
        <Stat label="relations" value={edgeCount} />
        <Stat label="rows" value={totalRows > 0 ? totalRows.toLocaleString() : '—'} />
        <Stat label="active" value={activeQueries} accent={activeQueries > 0} />
        {hottestLabel !== '—' && (
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-sm text-cosmos-hot">{hottestLabel}</span>
            <span className="text-cosmos-muted text-xs uppercase tracking-widest">hottest</span>
          </div>
        )}
      </div>

      {/* Right: activity pulse + fps */}
      <div className="ml-auto flex items-center gap-4">
        {activities.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-cosmos-accent animate-pulse" />
            <span className="font-mono text-xs text-cosmos-accent">
              {activities.slice(0, 3).map(a => a.sourceTables[0]).filter(Boolean).join(', ')}
            </span>
          </div>
        )}
        <span className="font-mono text-xs text-cosmos-muted">{fps} fps</span>
      </div>
    </div>
  );
}
