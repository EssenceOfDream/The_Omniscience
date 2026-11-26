import path from 'node:path';
import { spawn } from 'node:child_process';

import windowsAppIconHostPath from './windowsAppIconHostPath.mjs';

export default async function (requests, context = {}) {
  if (requests.length === 0) return new Map();
  if (typeof context.extractWindowsAppIcons === 'function') {
    return context.extractWindowsAppIcons(requests);
  }

  const systemRoot = typeof context === 'string'
    ? process.env.SystemRoot ?? 'C:\\Windows'
    : context.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows';
  const powershellPath = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const output = await new Promise((resolve, reject) => {
    const child = spawn(powershellPath, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', windowsAppIconHostPath,
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Windows app icon extraction timed out.'));
    }, 30000);

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 48 * 1024 * 1024 && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill();
        reject(new Error('Windows app icon extraction output exceeded the limit.'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString('utf8')
          || `PowerShell exited with code ${code}.`));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8'));
    });
    child.stdin.on('error', (error) => {
      if (settled || error.code === 'EPIPE') return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(error);
    });
    child.stdin.end(JSON.stringify({ requests }), 'utf8');
  });

  let entries;
  try {
    const parsed = JSON.parse(output);
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    throw new Error(`Could not parse Windows app icon extraction response: ${error.message}`);
  }
  return new Map(entries.map((entry) => [entry.id, entry]));
}