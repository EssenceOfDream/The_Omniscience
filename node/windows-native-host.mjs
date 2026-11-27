import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';

export function normalizeWindowsPath(value) {
  if (value.startsWith('\\\\?\\UNC\\')) return `\\\\${value.slice(8)}`;
  if (value.startsWith('\\\\?\\')) return value.slice(4);
  return value;
}

export function startWindowsNativeHost(projectRoot) {
  const scriptPath = path.join(normalizeWindowsPath(projectRoot), 'main', 'windowsNativeHost.ps1');
  const child = spawn('powershell.exe', [
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
    console.error('[tauri-windows-native]', data.trimEnd());
  });
  output.on('line', (line) => {
    let response;
    try {
      response = JSON.parse(line);
    } catch (error) {
      const failure = new Error(`Windows native helper returned invalid JSON: ${error.message}`);
      console.error('[tauri-windows-native]', failure.message);
      rejectPending(failure);
      return;
    }

    const request = pending.get(response.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(response.requestId);
    if (response.success === true) request.resolve(response.result);
    else request.reject(new Error(response.error || 'Windows native request failed'));
  });
  child.on('error', (error) => {
    markClosed(new Error(`Windows native helper failed to start: ${error.message}`));
  });
  child.on('close', (code) => {
    output.close();
    markClosed(closeError || new Error(`Windows native helper exited with status ${code}`));
  });

  return {
    request(action, payload = {}) {
      if (closed) {
        return Promise.reject(closeError || new Error('Windows native helper is unavailable'));
      }
      const id = ++requestId;
      const request = { requestId: id, action, ...payload };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Windows native request timed out: ${action}`));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
          if (!error) return;
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        });
      });
    },
    close() {
      if (closed) return;
      markClosed(new Error('Windows native helper was closed'));
      child.kill();
    },
  };
}
