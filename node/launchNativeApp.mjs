import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import windowsUwpHostPath from './windowsUwpHostPath.mjs';
import { isWindowsUwpAppUserModelId } from '../main/windowsUwpApps.js';
import listNativeApps from './listNativeApps.mjs';

const execFileAsync = promisify(execFile);

export default async function (payload, context = {}) {
  const platform = typeof context === 'string'
    ? process.platform
    : context.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new Error('Launching Windows apps is only supported on Windows');
  }
  const id = payload?.id;
  if (typeof id !== 'string') throw new Error('A Windows app id is required');

  const app = (await listNativeApps(context)).find((candidate) => candidate.id === id);
  if (!app) throw new Error('Windows app is no longer available');

  if (app.launchType === 'uwp') {
    const appUserModelId = app.launchTarget;
    if (!isWindowsUwpAppUserModelId(appUserModelId)) {
      throw new Error('Invalid packaged application id');
    }
    const systemRoot = context.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows';
    const powershellPath = path.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const runPowerShell = context.execFileAsync ?? execFileAsync;
    await runPowerShell(powershellPath, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      windowsUwpHostPath,
      '-Action',
      'Launch',
      '-AppId',
      appUserModelId,
    ], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    return { opened: true };
  }

  const explorerPath = path.join(
    context.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows',
    'explorer.exe',
  );
  const spawnProcess = context.spawn ?? spawn;
  await new Promise((resolve, reject) => {
    const child = spawnProcess(explorerPath, [app.launchTarget], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
  return { opened: true };
}