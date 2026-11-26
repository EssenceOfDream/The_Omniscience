import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import absoluteFilePath from './absoluteFilePath.mjs';
// ⚠️ В исходнике getWindowsNativeHost не объявлен. Подставь правильный путь.
import getWindowsNativeHost from './getWindowsNativeHost.mjs';

export default async function (payload, context) {
  const filePath = absoluteFilePath(payload?.path);
  await lstat(filePath);
  const platform = typeof context === 'string' ? process.platform : context.platform ?? process.platform;
  if (platform === 'win32') {
    const nativeHost = getWindowsNativeHost(context);
    const result = await nativeHost.request('open-path', { path: filePath });
    if (result !== true) throw new Error(`Could not open ${filePath}`);
    return { opened: true };
  }

  const executable = platform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [filePath], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({ opened: true });
    });
  });
}