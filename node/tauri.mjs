import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tauriCli = require.resolve('@tauri-apps/cli/tauri.js');
const args = process.argv.slice(2);

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine an available local port.'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  });
}

if (args[0] === 'dev') {
  const existingConfig = process.env.TAURI_CONFIG
    ? JSON.parse(process.env.TAURI_CONFIG)
    : {};
  if (!existingConfig || typeof existingConfig !== 'object' || Array.isArray(existingConfig)) {
    throw new Error('TAURI_CONFIG must contain a JSON object.');
  }

  const requestedPort = Number.parseInt(process.env.OMNISCIENCE_DEV_PORT ?? '', 10);
  const hasRequestedPort = Number.isInteger(requestedPort)
    && requestedPort > 0
    && requestedPort <= 65535
    && await isPortAvailable(requestedPort);
  const port = hasRequestedPort ? requestedPort : await findAvailablePort();
  process.env.OMNISCIENCE_DEV_PORT = String(port);
  const beforeDevCommand = [
    'npm run build:project',
    `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
  ].join(' && ');

  process.env.TAURI_CONFIG = JSON.stringify({
    ...existingConfig,
    build: {
      ...existingConfig.build,
      devUrl: `http://127.0.0.1:${port}`,
      beforeDevCommand,
    },
  });
  console.log(`[tauri] Using available preview port ${port}.`);
}

const child = spawn(process.execPath, [tauriCli, ...args], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolve(code));
});

process.exitCode = exitCode ?? 1;
