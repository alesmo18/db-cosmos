import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { DBDriver } from '@db-cosmos/shared';
import { useCosmosStore } from '../store';

const DRIVERS: { value: DBDriver; label: string; defaultPort: number }[] = [
  { value: 'postgres', label: 'PostgreSQL', defaultPort: 5432 },
  { value: 'mysql',    label: 'MySQL',      defaultPort: 3306 },
  { value: 'sqlite',   label: 'SQLite',     defaultPort: 0 },
];

interface FormState {
  driver: DBDriver;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
}

const DEFAULTS: FormState = {
  driver: 'postgres',
  host: 'localhost',
  port: '5432',
  database: '',
  user: '',
  password: '',
};

type DemoDb = 'pagila' | 'northwind';

async function postConnect(body: object): Promise<void> {
  const res = await fetch('/api/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? 'Connection failed');
  }
}

export function ConnectionForm(): React.ReactElement {
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [error, setError] = useState<string | null>(null);
  const { setConnecting, setShowConnectionForm, isConnecting } = useCosmosStore();

  const handleDriverChange = (driver: DBDriver) => {
    const info = DRIVERS.find(d => d.value === driver)!;
    setForm(f => ({ ...f, driver, port: String(info.defaultPort || f.port) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setConnecting(true);
    try {
      await postConnect({
        driver: form.driver,
        host: form.host,
        port: parseInt(form.port, 10),
        database: form.database,
        user: form.user || undefined,
        password: form.password || undefined,
      });
      setShowConnectionForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setConnecting(false);
    }
  };

  const handleDemo = async (demoDb: DemoDb) => {
    setError(null);
    setConnecting(true);
    try {
      await postConnect({ demo: true, demoDb });
      setShowConnectionForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo init failed');
    } finally {
      setConnecting(false);
    }
  };

  const isSqlite = form.driver === 'sqlite';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="glass-panel rounded-2xl p-8 w-full max-w-md shadow-2xl"
      style={{ boxShadow: '0 0 60px rgba(0,212,255,0.1)' }}
    >
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="text-cosmos-accent font-mono text-xl font-semibold tracking-wider text-glow mb-1">
          db-cosmos
        </div>
        <p className="text-cosmos-muted text-sm">Database Observatory</p>
      </div>

      {/* Demo buttons */}
      <div className="mb-2">
        <p className="text-cosmos-muted text-[10px] uppercase tracking-widest text-center mb-2">
          Demo databases
        </p>
        <div className="flex gap-2">
          {/* Pagila */}
          <button
            onClick={() => handleDemo('pagila')}
            disabled={isConnecting}
            className="flex-1 py-2.5 rounded-lg border border-cosmos-accent/40 text-cosmos-accent text-xs font-medium
              hover:bg-cosmos-accent/10 hover:border-cosmos-accent transition-all duration-200 disabled:opacity-50
              flex flex-col items-center gap-0.5"
          >
            {isConnecting ? (
              <span className="animate-pulse text-[11px]">Initialising…</span>
            ) : (
              <>
                <span>✦ Pagila</span>
                <span className="text-[9px] text-cosmos-muted font-normal normal-case tracking-normal">
                  Movie rental · 15 tables
                </span>
              </>
            )}
          </button>

          {/* Northwind */}
          <button
            onClick={() => handleDemo('northwind')}
            disabled={isConnecting}
            className="flex-1 py-2.5 rounded-lg border border-violet-500/40 text-violet-400 text-xs font-medium
              hover:bg-violet-500/10 hover:border-violet-500 transition-all duration-200 disabled:opacity-50
              flex flex-col items-center gap-0.5"
          >
            {isConnecting ? (
              <span className="animate-pulse text-[11px]">Initialising…</span>
            ) : (
              <>
                <span>✦ Northwind</span>
                <span className="text-[9px] text-cosmos-muted font-normal normal-case tracking-normal">
                  Trading co. · 11 tables
                </span>
              </>
            )}
          </button>
        </div>

        <p className="text-cosmos-muted text-[10px] mt-1.5 text-center">
          Requires <span className="font-mono">docker compose up</span> · ports&nbsp;5433 / 5434 · SQLite fallback if unavailable
        </p>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-px bg-cosmos-border" />
        <span className="text-cosmos-muted text-xs">or connect your database</span>
        <div className="flex-1 h-px bg-cosmos-border" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Driver */}
        <div>
          <label className="block text-xs text-cosmos-muted uppercase tracking-widest mb-1.5">Database</label>
          <div className="flex gap-2">
            {DRIVERS.map(d => (
              <button
                key={d.value}
                type="button"
                onClick={() => handleDriverChange(d.value)}
                className={`flex-1 py-1.5 text-xs rounded-md border transition-all ${
                  form.driver === d.value
                    ? 'border-cosmos-accent text-cosmos-accent bg-cosmos-accent/10'
                    : 'border-cosmos-border text-cosmos-muted hover:border-cosmos-accent/50'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Host / Port — hidden for SQLite */}
        {!isSqlite && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-cosmos-muted uppercase tracking-widest mb-1.5">Host</label>
              <input
                type="text"
                value={form.host}
                onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                className="w-full bg-cosmos-surface border border-cosmos-border rounded-md px-3 py-2 text-sm text-cosmos-text
                  focus:outline-none focus:border-cosmos-accent transition-colors"
                placeholder="localhost"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs text-cosmos-muted uppercase tracking-widest mb-1.5">Port</label>
              <input
                type="number"
                value={form.port}
                onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                className="w-full bg-cosmos-surface border border-cosmos-border rounded-md px-3 py-2 text-sm text-cosmos-text
                  focus:outline-none focus:border-cosmos-accent transition-colors"
              />
            </div>
          </div>
        )}

        {/* Database / file path */}
        <div>
          <label className="block text-xs text-cosmos-muted uppercase tracking-widest mb-1.5">
            {isSqlite ? 'File path (or :memory:)' : 'Database'}
          </label>
          <input
            type="text"
            value={form.database}
            onChange={e => setForm(f => ({ ...f, database: e.target.value }))}
            className="w-full bg-cosmos-surface border border-cosmos-border rounded-md px-3 py-2 text-sm text-cosmos-text
              focus:outline-none focus:border-cosmos-accent transition-colors"
            placeholder={isSqlite ? '/path/to/db.sqlite' : 'mydb'}
            required
          />
        </div>

        {/* User / Password — hidden for SQLite */}
        {!isSqlite && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-cosmos-muted uppercase tracking-widest mb-1.5">User</label>
              <input
                type="text"
                value={form.user}
                onChange={e => setForm(f => ({ ...f, user: e.target.value }))}
                className="w-full bg-cosmos-surface border border-cosmos-border rounded-md px-3 py-2 text-sm text-cosmos-text
                  focus:outline-none focus:border-cosmos-accent transition-colors"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-cosmos-muted uppercase tracking-widest mb-1.5">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className="w-full bg-cosmos-surface border border-cosmos-border rounded-md px-3 py-2 text-sm text-cosmos-text
                  focus:outline-none focus:border-cosmos-accent transition-colors"
              />
            </div>
          </div>
        )}

        {error && (
          <div className="text-red-400 text-xs bg-red-900/20 border border-red-800/40 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isConnecting || !form.database}
          className="w-full py-3 rounded-lg bg-cosmos-accent/20 border border-cosmos-accent/50 text-cosmos-accent text-sm font-medium
            hover:bg-cosmos-accent/30 transition-all duration-200 disabled:opacity-40"
        >
          {isConnecting ? <span className="animate-pulse">Connecting…</span> : 'Connect'}
        </button>
      </form>
    </motion.div>
  );
}
