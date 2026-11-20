import { execFile, spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const APP_PATH_REGISTRY_KEYS = [
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Everything.exe',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Everything.exe',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Everything.exe',
];

export function getEverythingExecutableCandidates(env = process.env) {
  const installRoots = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'),
  ].filter(Boolean);

  return installRoots.map((root) => path.join(root, 'Everything', 'Everything.exe'));
}

export function parseEverythingRegistryPath(output) {
  const match = output.match(/^\s*\(Default\)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/im);
  return match?.[1].replace(/^"|"$/g, '') || null;
}

async function readRegistryExecutable(key) {
  const { stdout } = await execFileAsync('reg.exe', ['query', key, '/ve'], {
    windowsHide: true,
    timeout: 5000,
  });
  return parseEverythingRegistryPath(stdout);
}

export async function resolveEverythingExecutable({
  env = process.env,
  fileExists = existsSync,
  readRegistryPath = readRegistryExecutable,
} = {}) {
  for (const candidate of getEverythingExecutableCandidates(env)) {
    if (fileExists(candidate)) return candidate;
  }

  for (const key of APP_PATH_REGISTRY_KEYS) {
    let candidate;
    try {
      candidate = await readRegistryPath(key);
    } catch (error) {
      if (error.code === 1) continue;
      throw error;
    }

    if (candidate && fileExists(candidate)) return candidate;
  }

  throw new Error('Everything.exe was not found. Install Everything to use panel search.');
}

export async function openEverything() {
  const executable = await resolveEverythingExecutable();
  const child = spawn(executable, [], { detached: true, stdio: 'ignore' });

  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });

  child.unref();
}
