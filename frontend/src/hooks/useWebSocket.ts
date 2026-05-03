import { useEffect, useRef } from 'react';
import type { WsMessage } from '@db-cosmos/shared';
import { useCosmosStore } from '../store';

const WS_URL = `ws://${window.location.hostname}:3001/ws`;
const RECONNECT_DELAY_MS = 2000;

export function useWebSocket(): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Use a ref so we can access the latest interval inside callbacks without
  // adding it to the connect-effect deps (which would tear down/recreate the WS).
  const pollIntervalMsRef = useRef(1000);
  const pollIntervalMs = useCosmosStore(s => s.pollIntervalMs);
  useEffect(() => {
    pollIntervalMsRef.current = pollIntervalMs;
  }, [pollIntervalMs]);

  const {
    setGraph,
    updateMetrics,
    addActivities,
    setConnectionStatus,
  } = useCosmosStore();

  // ── Main connect / reconnect loop ────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[ws] connected');
        // Sync the current poll interval immediately so the server respects it
        ws.send(JSON.stringify({
          type: 'set_poll_interval',
          payload: { intervalMs: pollIntervalMsRef.current },
        }));
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(event.data) as WsMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'graph_snapshot':
            setGraph(msg.payload as Parameters<typeof setGraph>[0]);
            break;
          case 'metrics_update': {
            const update = msg.payload as { tableMetrics: Record<string, import('@db-cosmos/shared').TableMetrics>; timestamp: number };
            updateMetrics(update.tableMetrics);
            break;
          }
          case 'activity_update':
            addActivities(msg.payload as import('@db-cosmos/shared').ActivityEvent[]);
            break;
          case 'connection_status':
            setConnectionStatus(msg.payload as import('@db-cosmos/shared').ConnectionStatus);
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        console.log('[ws] disconnected — reconnecting in', RECONNECT_DELAY_MS, 'ms');
        if (mountedRef.current) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = (err) => {
        console.error('[ws] error', err);
        ws.close();
      };
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [setGraph, updateMetrics, addActivities, setConnectionStatus]);

  // ── Sync poll interval whenever slider changes ────────────────────────────
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'set_poll_interval',
      payload: { intervalMs: pollIntervalMs },
    }));
  }, [pollIntervalMs]);
}
