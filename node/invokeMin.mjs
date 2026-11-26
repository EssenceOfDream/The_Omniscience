import startMinServer from './startMinServer.mjs';
import { state } from './state.mjs';

export default async function (instanceId, channel, args) {
  if (channel === 'start-server') return startMinServer(instanceId, args[0]);
  if (channel === 'stop-server') {
    const active = state.minServers.get(instanceId);
    if (active) {
      state.minServers.delete(instanceId);
      for (const client of active.clients) client.close();
      await new Promise((resolve) => active.server.close(resolve));
    }
    return { success: true };
  }
  throw new Error(`Unsupported Min channel ${channel}`);
}