import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import getWindowsNativeHost from './getWindowsNativeHost.mjs';

const execFileAsync = promisify(execFile);

export default async function (action, context) {
  const allowedActions = ['logout', 'shutdown', 'restart', 'sleep'];
  if (!allowedActions.includes(action)) {
    throw new Error(`Unsupported power action: ${action}`);
  }

  const platform = typeof context === 'string'
    ? process.platform
    : context.platform ?? process.platform;

  if (platform === 'win32') {
    if (action === 'sleep') {
      const result = await getWindowsNativeHost(context).request('suspend');
      if (result !== true) throw new Error('Windows sleep request failed');
      return { ok: true };
    }

    const args = {
      logout: ['/l'],
      shutdown: ['/s', '/t', '0'],
      restart: ['/r', '/t', '0'],
    }[action];
    const executable = path.join(
      typeof context === 'string'
        ? process.env.SystemRoot ?? 'C:\\Windows'
        : context.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'shutdown.exe',
    );
    const run = typeof context === 'string' ? execFileAsync : context.execFileAsync ?? execFileAsync;
    await run(executable, args, { windowsHide: true, timeout: 10000 });
    return { ok: true };
  }

  if (platform === 'linux') {
    const run = typeof context === 'string' ? execFileAsync : context.execFileAsync ?? execFileAsync;
    if (action === 'sleep') {
      await run('systemctl', ['suspend'], { timeout: 15000 });
    } else if (action === 'shutdown' || action === 'restart') {
      await run('systemctl', [action === 'shutdown' ? 'poweroff' : 'reboot'], {
        timeout: 15000,
      });
    } else {
      const sessionId = typeof context === 'string'
        ? process.env.XDG_SESSION_ID
        : context.sessionId ?? process.env.XDG_SESSION_ID;
      if (sessionId) {
        await run('loginctl', ['terminate-session', sessionId], { timeout: 15000 });
      } else {
        const username = typeof context === 'string'
          ? os.userInfo().username
          : context.username ?? os.userInfo().username;
        await run('loginctl', ['terminate-user', username], { timeout: 15000 });
      }
    }
    return { ok: true };
  }

  throw new Error(`Power actions are not supported on ${platform}`);
}