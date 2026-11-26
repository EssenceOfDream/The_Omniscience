import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import absoluteFilePath from './absoluteFilePath.mjs';

export default async function (payload, context) {
  const filePath = absoluteFilePath(payload?.path);
  await lstat(filePath);
  const platform = typeof context === 'string' ? process.platform : context.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new Error('Open With is only supported on Windows');
  }
  const spawnProcess = typeof context === 'string' ? spawn : context.spawnProcess ?? spawn;
  return new Promise((resolve, reject) => {
    const child = spawnProcess('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', filePath], {
      detached: true,
      stdio: 'ignore',
    });
    const onError = (error) => reject(error);
    child.once('error', onError);
    child.once('spawn', () => {
      child.removeListener('error', onError);
      child.unref();
      resolve({ opened: true });
    });
  });
}