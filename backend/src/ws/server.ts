import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import type { WsMessage } from '@db-cosmos/shared';

export function createWsServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = req.socket.remoteAddress ?? 'unknown';
    console.log(`[ws] client connected from ${ip} (total: ${wss.clients.size})`);

    ws.on('close', () => {
      console.log(`[ws] client disconnected (remaining: ${wss.clients.size})`);
    });

    ws.on('error', (err: Error) => {
      console.error('[ws] client error:', err.message);
    });
  });

  return wss;
}

export function broadcast(wss: WebSocketServer, msg: WsMessage): void {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
