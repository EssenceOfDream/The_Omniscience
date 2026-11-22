import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const POWERSHELL_PATH = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
const ICON_HOST_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'windowsIconHost.ps1');
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const TIMEOUT_MS = 30000;

export async function extractWindowsIcons(requests) {
  if (requests.length === 0) return new Map();

  const output = await new Promise((resolve, reject) => {
    const process = spawn(POWERSHELL_PATH, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', ICON_HOST_PATH,
    ], { windowsHide: true });

    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      process.kill();
      reject(new Error('Windows icon extraction timed out.'));
    }, TIMEOUT_MS);

    process.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES && !settled) {
        settled = true;
        clearTimeout(timeout);
        process.kill();
        reject(new Error('Windows icon extraction output exceeded the limit.'));
        return;
      }
      stdout.push(chunk);
    });
    process.stderr.on('data', (chunk) => stderr.push(chunk));
    process.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    process.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString('utf8') || `PowerShell exited with code ${code}.`));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8'));
    });

    process.stdin.on('error', (error) => {
      if (settled || error.code === 'EPIPE') return;
      settled = true;
      clearTimeout(timeout);
      process.kill();
      reject(error);
    });
    process.stdin.end(JSON.stringify(requests), 'utf8');
  });

  let results;
  try {
    results = JSON.parse(output);
  } catch (error) {
    throw new Error(`Could not parse Windows icon extraction response: ${error.message}`);
  }

  const entries = Array.isArray(results) ? results : [results];
  return new Map(entries.map((entry) => [entry.id, entry]));
}
