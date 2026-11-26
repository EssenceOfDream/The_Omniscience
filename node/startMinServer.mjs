import { WebSocket, WebSocketServer } from 'ws';
import { state } from './state.mjs';

export default async function (instanceId, rawPort) {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { success: false, error: 'Порт должен быть числом от 1 до 65535' };
  }
  const previous = state.minServers.get(instanceId);
  if (previous) {
    for (const client of previous.clients) client.close();
    await new Promise((resolve) => previous.server.close(resolve));
    state.minServers.delete(instanceId);
  }

  const server = new WebSocketServer({ port, host: '0.0.0.0' });
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  } catch (error) {
    server.close();
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const clients = new Set();
  server.on('connection', (socket) => {
    clients.add(socket);
    socket.on('message', (data, isBinary) => {
      for (const client of clients) {
        if (client !== socket && client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
      }
    });
    socket.on('close', () => clients.delete(socket));
  });
  server.on('error', (error) => {
    console.error('[Min] WebSocket server error:', error);
  });
  const address = server.address();
  const activePort = address && typeof address === 'object' ? address.port : port;
  state.minServers.set(instanceId, { server, clients });
  return { success: true, port: activePort };
}