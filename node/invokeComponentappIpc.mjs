import getComponentappInstance from './getComponentappInstance.mjs';
import invokeNetworkManager from './invokeNetworkManager.mjs';
import invokeMin from './invokeMin.mjs';
import invokeArchiver from './invokeArchiver.mjs';
import invokeTerminal from './invokeTerminal.mjs';

export default async function (payload, context) {
  const appId = payload?.appId;
  const channel = payload?.channel;
  const args = payload?.args;
  if (typeof appId !== 'string' || typeof channel !== 'string' || !Array.isArray(args)) {
    throw new Error('Componentapp id, channel, and arguments are required');
  }
  const instanceId = getComponentappInstance(payload);

  if (appId === 'NetworkManager') return invokeNetworkManager(channel, args, context);
  if (appId === 'Min') return invokeMin(instanceId, channel, args);
  if (appId === 'omni-archiver') return invokeArchiver(instanceId, channel, args);
  if (appId === 'xterm') return invokeTerminal(instanceId, channel, args);

  throw new Error(`Unsupported legacy IPC channel ${channel} for componentapp ${appId}`);
}