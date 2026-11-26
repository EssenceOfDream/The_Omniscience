import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  readFile,
  stat,
} from 'node:fs/promises';

import {
  defaultWindowsIconState,
  windowsAppIconHostPath
} from './constants.mjs';

import {absoluteFilePath} from './fs.mjs';

export function getWindowsIconState(context) {
  if (typeof context === 'string') return defaultWindowsIconState;
  if (!context.windowsIconState) {
    context.windowsIconState = {
      cache: new Map(),
      pending: new Map(),
      queued: new Map(),
      flushScheduled: false,
    };
  }
  return context.windowsIconState;
}

export async function extractWindowsAppIcons(requests, context = {}) {
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

export function scheduleWindowsIconExtraction(state, context) {
  if (state.flushScheduled) return;
  state.flushScheduled = true;
  setTimeout(() => void flushWindowsIconQueue(state, context), 10);
}

export async function flushWindowsIconQueue(state, context) {
  state.flushScheduled = false;
  const queued = [...state.queued.entries()];
  state.queued.clear();
  if (queued.length === 0) return;

  let extracted = new Map();
  try {
    extracted = await extractWindowsAppIcons(
      queued.map(([key, request]) => ({ id: key, path: request.path })),
      context,
    );
  } catch (error) {
    console.error('[tauri-icons] Windows app icon extraction failed:', error.message);
  }

  for (const [key, request] of queued) {
    const result = extracted.get(key);
    if (result?.error) {
      console.warn('[tauri-icons] could not extract icon:', request.path, result.error);
    }
    const icon = result?.dataUrl || null;
    state.cache.set(key, icon);
    state.pending.delete(key);
    request.resolve(icon);
  }

  if (state.queued.size > 0) scheduleWindowsIconExtraction(state, context);
}

export async function getWindowsIcons(requests, context = {}) {
  const state = getWindowsIconState(context);
  const icons = await Promise.all(requests.map((request) => {
    const key = request.path.toLowerCase();
    if (state.cache.has(key)) return state.cache.get(key);
    if (state.pending.has(key)) return state.pending.get(key);

    let resolve;
    const pending = new Promise((complete) => {
      resolve = complete;
    });
    state.pending.set(key, pending);
    state.queued.set(key, { ...request, resolve });
    scheduleWindowsIconExtraction(state, context);
    return pending;
  }));
  return new Map(requests.map((request, index) => [request.id, icons[index] || null]));
}

export async function getFileIcons(payload, context) {
  const paths = Array.isArray(payload?.paths) ? payload.paths : [];
  const resolvedPaths = paths.map(absoluteFilePath);
  const entries = await Promise.all(resolvedPaths.map(async (filePath) => {
    try {
      const info = await stat(filePath);
      return info.isFile() || info.isDirectory() ? filePath : null;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    }
  }));
  const validPaths = entries.filter(Boolean);
  const platform = typeof context === 'string'
    ? process.platform
    : context.platform ?? process.platform;
  if (platform !== 'win32') return Object.fromEntries(resolvedPaths.map((filePath) => [filePath, null]));

  const icons = await getWindowsIcons(
    validPaths.map((filePath) => ({ id: filePath, path: filePath })),
    context,
  );
  return Object.fromEntries(resolvedPaths.map((filePath, index) => [
    filePath,
    entries[index] ? icons.get(filePath) || null : null,
  ]));
}

export async function getFileIcon(payload, context) {
  const filePath = absoluteFilePath(payload?.path);
  const icons = await getFileIcons({ paths: [filePath] }, context);
  const fileUrl = icons[filePath] || null;
  return { success: Boolean(fileUrl), fileUrl };
}

export async function getProgramIcon(projectRoot, category, name) {
  const mimeTypes = {
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  for (const extension of Object.keys(mimeTypes)) {
    try {
      const icon = await readFile(path.join(projectRoot, category, name, `favicon${extension}`));
      return `data:${mimeTypes[extension]};base64,${icon.toString('base64')}`;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  return null;
}