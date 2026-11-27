import { open, readFile, writeFile } from 'node:fs/promises';
import absoluteComponentappPath from './absoluteComponentappPath.mjs';
import listComponentappFiles from './listComponentappFiles.mjs';
import getComponentappInstance from './getComponentappInstance.mjs';
import invokeNetworkManager from './invokeNetworkManager.mjs';
import performPowerAction from './performPowerAction.mjs';
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

  if (appId === 'Chonky') {
    if (channel === 'get-files') {
      return listComponentappFiles(args[0]);
    }
  }

  if (appId === 'Monaco') {
    if (channel === 'get-files') {
      return listComponentappFiles(args[0]);
    }
    if (channel === 'read-file') {
      const filePath = absoluteComponentappPath(args[0]);
      try {
        return { success: true, content: await readFile(filePath, 'utf8') };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    if (channel === 'write-file') {
      const filePath = absoluteComponentappPath(args[0]);
      if (typeof args[1] !== 'string') throw new Error('File content must be a string');
      try {
        await writeFile(filePath, args[1], 'utf8');
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    if (channel === 'check-text-file') {
      const filePath = absoluteComponentappPath(args[0]);
      let file;
      try {
        file = await open(filePath, 'r');
        const buffer = Buffer.alloc(4096);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        return !buffer.subarray(0, bytesRead).includes(0);
      } catch {
        return false;
      } finally {
        await file?.close();
      }
    }
  }

  if (appId === 'NetworkManager') return invokeNetworkManager(channel, args, context);
  if (appId === 'power-menu' && channel === 'power-menu:execute') {
    return performPowerAction(args[0]?.action, context);
  }
  if (appId === 'Min') return invokeMin(instanceId, channel, args);
  if (appId === 'omni-archiver') return invokeArchiver(instanceId, channel, args);
  if (appId === 'xterm') return invokeTerminal(instanceId, channel, args);

  throw new Error(`Unsupported legacy IPC channel ${channel} for componentapp ${appId}`);
}