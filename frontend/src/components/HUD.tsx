import React from 'react';
import { useCosmosStore } from '../store';

export function HUD(): React.ReactElement {
  const connectionStatus    = useCosmosStore(s => s.connectionStatus);
  const showConnectionForm  = useCosmosStore(s => s.showConnectionForm);
  const setShowConnectionForm = useCosmosStore(s => s.setShowConnectionForm);
  const pollIntervalMs      = useCosmosStore(s => s.pollIntervalMs);
  const setPollIntervalMs   = useCosmosStore(s => s.setPollIntervalMs);

  return (
    <div
      className="glass-panel absolute top-0 left-0 right-0 h-12 flex items-center px-6 gap-6
        border-b border-cosmos-border/50 z-10"
    >
      {/* Brand */}
      <span className="font-mono text-cosmos-accent text-sm font-semibold tracking-widest text-glow">
        db-cosmos
      </span>

      <div className="h-4 w-px bg-cosmos-border" />

      {/* Connection indicator */}
      <div className="flex items-center gap-2">
        <div
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            connectionStatus.connected ? 'bg-emerald-400' : 'bg-cosmos-muted'
          }`}
          style={connectionStatus.connected ? { boxShadow: '0 0 6px #34d399' } : {}}
        />
        <span className="text-xs text-cosmos-muted font-mono">
          {connectionStatus.connected
            ? `${connectionStatus.driver} · ${connectionStatus.database ?? ''}`
            : 'no connection'}
        </span>
        {connectionStatus.nodeCount != null && (
          <span className="text-xs text-cosmos-muted">
            ({connectionStatus.nodeCount} tables)
          </span>
        )}
        {connectionStatus.demoFallback && (
          <span className="text-xs text-yellow-500/80 font-mono ml-2">
            ⚠ Docker unavailable — SQLite fallback
          </span>
        )}
      </div>

      {/* Right controls */}
      <div className="ml-auto flex items-center gap-5">

        {/* Live poll interval slider */}
        <div
          className="flex items-center gap-1.5"
          title={`Backend poll interval: ${(pollIntervalMs / 1000).toFixed(1)}s`}
        >
          <span className="text-[9px] text-cosmos-muted/70 uppercase tracking-widest select-none">
            poll
          </span>
          <input
            type="range"
            min={500}
            max={5000}
            step={250}
            value={pollIntervalMs}
            onChange={e => setPollIntervalMs(parseInt(e.target.value, 10))}
            className="w-16 h-1 cursor-pointer accent-cosmos-accent"
          />
          <span className="text-[10px] font-mono text-cosmos-muted w-7 text-right tabular-nums select-none">
            {(pollIntervalMs / 1000).toFixed(1)}s
          </span>
        </div>

        <div className="h-4 w-px bg-cosmos-border" />

        {/* Connect / reconnect */}
        <button
          onClick={() => setShowConnectionForm(!showConnectionForm)}
          className={`text-xs px-3 py-1 rounded-md border transition-all ${
            showConnectionForm
              ? 'border-cosmos-accent/50 text-cosmos-accent bg-cosmos-accent/10'
              : 'border-cosmos-border text-cosmos-muted hover:border-cosmos-accent/50 hover:text-cosmos-text'
          }`}
        >
          {connectionStatus.connected ? 'reconnect' : 'connect'}
        </button>
      </div>
    </div>
  );
}
