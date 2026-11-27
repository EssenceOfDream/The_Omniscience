import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';

import { normalizeWindowsPath } from './windows-native-host.mjs';

export function startWindowsAppIconHost(projectRoot) {
  const scriptPath = path.join(
    normalizeWindowsPath(projectRoot),
    'main',
    'windowsAppIcons.ps1',
  );
  const powershellPath = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const child = spawn(powershellPath, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
  ], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  const output = readline.createInterface({ input: child.stdout });
  let requestId = 0;
  let closed = false;
  let closeError = null;

  function rejectPending(error) {
    for (const [id, request] of pending) {
      clearTimeout(request.timer);
      pending.delete(id);
      request.reject(error);
    }
  }

  function markClosed(error) {
    closed = true;
    closeError = error;
    rejectPending(error);
  }

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (data) => {
    console.error('[tauri-icons]', data.trimEnd());
  });
  output.on('line', (line) => {
    if (Buffer.byteLength(line, 'utf8') > 48 * 1024 * 1024) {
      const failure = new Error('Windows app icon extraction output exceeded the limit.');
      markClosed(failure);
      child.kill();
      return;
    }

    let response;
    try {
      response = JSON.parse(line);
    } catch (error) {
      const failure = new Error(`Windows icon helper returned invalid JSON: ${error.message}`);
      console.error('[tauri-icons]', failure.message);
      rejectPending(failure);
      return;
    }

    const request = pending.get(response.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(response.requestId);
    if (response.success === true) request.resolve(response.entries);
    else request.reject(new Error(response.error || 'Windows icon extraction failed'));
  });
  child.on('error', (error) => {
    markClosed(new Error(`Windows icon helper failed to start: ${error.message}`));
  });
  child.on('close', (code) => {
    output.close();
    markClosed(closeError || new Error(`Windows icon helper exited with status ${code}`));
  });

  return {
    request(requests) {
      if (closed) {
        return Promise.reject(closeError || new Error('Windows icon helper is unavailable'));
      }

      const id = ++requestId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Windows app icon extraction timed out.'));
        }, 30000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ requestId: id, requests })}\n`, (error) => {
          if (!error) return;
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        });
      });
    },
    close() {
      if (closed) return;
      markClosed(new Error('Windows icon helper was closed'));
      child.kill();
    },
  };
}
