import path from 'node:path';
import { spawn } from 'node:child_process';
import windowsSettingsCategories from './windowsSettingsCategories.mjs';

export default function (payload, context = {}) {
  const platform = context.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new Error('Windows settings are only available on Windows');
  }
  const category = payload?.category;
  if (typeof category !== 'string'
    || !Object.prototype.hasOwnProperty.call(windowsSettingsCategories, category)) {
    throw new Error('Windows settings category was not found');
  }

  const controlPath = path.join(
    context.windir ?? process.env.WINDIR ?? 'C:\\Windows',
    'System32',
    'control.exe',
  );
  const spawnProcess = context.spawn ?? spawn;
  return new Promise((resolve, reject) => {
    const child = spawnProcess(controlPath, windowsSettingsCategories[category], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}