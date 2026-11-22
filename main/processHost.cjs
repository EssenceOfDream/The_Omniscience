const electron = require('electron');
const { app, Tray, Menu, nativeImage, shell } = electron;
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const electronExecutable = process.execPath;
const statusState = {
  changed: [],
  busy: null,
  lastError: null,
  childPid: null,
};

let child = null;
let intentionalChildStop = false;
let tray = null;
let trayMenu = null;
let trayMenuOpen = false;
let reopenTrayMenuAfterClose = false;
let fallbackScanTimer = null;
let restartTimer = null;
let changeTimer = null;
let sourceEventTimer = null;
let snapshot = new Map();
let sourceWatcher = null;
const pendingSourcePaths = new Set();
let quitting = false;

const ignoredDirectories = new Set([
  '.git', '.temp', 'node_modules', 'dist', 'extracted-extensions',
]);

function classify(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  const first = normalized.split('/')[0];
  if (first === 'componentapps') return 'componentapps';
  if (first === 'webapps') return 'webapps';
  if (first === 'extensions') return 'extensions';
  if (['src', 'public', 'themes', 'texts', 'voices', 'speech'].includes(first)) return 'renderer';
  if (['main', 'index.mjs', 'package.json', 'package-lock.json', 'config.json'].includes(first)
    || normalized.startsWith('main/')) return 'main';
  return 'project';
}

function requiresFullRestart(relativePath) {
  return classify(relativePath) === 'main'
    || classify(relativePath) === 'project';
}

function isIgnored(relativePath) {
  const parts = relativePath.split(/[\\/]/);
  return parts.some((part) => ignoredDirectories.has(part));
}

async function createSnapshot(root = projectRoot, prefix = '') {
  const result = new Map();

  async function visit(directory, relativeDirectory) {
    let entries;
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      if (isIgnored(relative)) continue;
      if (entry.isDirectory()) {
        await visit(absolute, relative);
      } else if (entry.isFile()) {
        try {
          const data = await fs.promises.readFile(absolute);
          const hash = crypto.createHash('sha256').update(data).digest('hex');
          result.set(relative, hash);
        } catch {}
      }
    }
  }

  await visit(root, prefix);
  return result;
}

function updateTray() {
  if (!tray) return;
  const count = statusState.changed.length;
  tray.setToolTip(count
    ? `Omniscience: ${count} uncommitted source changes`
    : 'Omniscience: no source changes');
  trayMenu = Menu.buildFromTemplate([
    {
      label: statusState.busy || (count
        ? `Есть неприменённые изменения: ${count}`
        : 'Изменений не обнаружено'),
      enabled: false,
    },
    { type: 'separator' },
    { label: 'Пересобрать и применить', enabled: count > 0 && !statusState.busy, click: applyChanges },
    { label: 'Перезагрузить интерфейсы', enabled: !statusState.busy, click: reloadRenderers },
    { label: 'Полный перезапуск', enabled: !statusState.busy, click: restartOmniscience },
    { type: 'separator' },
    { label: 'Открыть папку проекта', click: () => shell.openPath(projectRoot) },
    { type: 'separator' },
    { label: 'Закрыть Omniscience', click: () => app.quit() },
  ]);
  trayMenu.on('menu-will-show', () => { trayMenuOpen = true; });
  trayMenu.on('menu-will-close', () => {
    trayMenuOpen = false;
    if (process.platform === 'win32' && tray && !tray.isDestroyed()) tray.focus();
    if (reopenTrayMenuAfterClose) {
      reopenTrayMenuAfterClose = false;
      setImmediate(showTrayMenu);
    }
  });
  tray.setContextMenu(trayMenu);
  if (child && child.connected) {
    child.send({ type: 'host-status', status: getStatus() });
  }
}

function showTrayMenu() {
  if (!tray || tray.isDestroyed() || !trayMenu) return;
  if (trayMenuOpen) {
    reopenTrayMenuAfterClose = true;
    tray.closeContextMenu();
    return;
  }
  tray.popUpContextMenu(trayMenu);
}

function setBusy(value) {
  statusState.busy = value;
  updateTray();
}

function getStatus() {
  return {
    changed: statusState.changed,
    busy: statusState.busy,
    lastError: statusState.lastError,
    childPid: statusState.childPid,
  };
}

async function hashFile(filePath) {
  const data = await fs.promises.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function commitChanges(entries) {
  if (!entries.length) return;
  statusState.changed = mergeChanges(statusState.changed, entries);
  statusState.lastError = null;
  updateTray();

  const onlyBuildable = statusState.changed.every((item) =>
    ['componentapps', 'webapps', 'extensions', 'renderer'].includes(item.category));
  const noFullRestart = statusState.changed.every((item) => !requiresFullRestart(item.path));
  if (onlyBuildable && noFullRestart) {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      buildAndReload().catch((error) => {
        statusState.lastError = error.message;
        console.error('[process-host] automatic build failed:', error);
        updateTray();
      });
    }, 700);
  }
}

async function processChangedPath(relativePath) {
  const normalized = path.normalize(relativePath);
  if (!normalized || normalized === '.' || path.isAbsolute(normalized) || isIgnored(normalized)) return [];

  const absolutePath = path.resolve(projectRoot, normalized);
  if (!absolutePath.startsWith(`${projectRoot}${path.sep}`)) return [];

  let stat;
  try {
    stat = await fs.promises.stat(absolutePath);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }

  if (stat?.isDirectory()) {
    const subtree = await createSnapshot(absolutePath, normalized);
    const changes = [];
    for (const [file, hash] of subtree) {
      const previousHash = snapshot.get(file);
      if (previousHash !== hash) {
        snapshot.set(file, hash);
        changes.push({ path: file.replace(/\\/g, '/'), type: previousHash ? 'changed' : 'added', category: classify(file) });
      }
    }
    return changes;
  }

  if (stat?.isFile()) {
    const hash = await hashFile(absolutePath);
    const previousHash = snapshot.get(normalized);
    if (previousHash !== hash) {
      snapshot.set(normalized, hash);
      return [{
        path: normalized.replace(/\\/g, '/'),
        type: previousHash ? 'changed' : 'added',
        category: classify(normalized),
      }];
    }
    return [];
  }

  const deletedFiles = [...snapshot.keys()].filter((file) =>
    file === normalized || file.startsWith(`${normalized}${path.sep}`));
  const changes = [];
  for (const file of deletedFiles) {
    snapshot.delete(file);
    changes.push({ path: file.replace(/\\/g, '/'), type: 'deleted', category: classify(file) });
  }
  return changes;
}

async function flushSourceChanges() {
  sourceEventTimer = null;
  const paths = [...pendingSourcePaths];
  pendingSourcePaths.clear();
  const results = await Promise.all(paths.map((relativePath) => processChangedPath(relativePath)));
  commitChanges(results.flat());
}

function startSourceWatcher() {
  try {
    sourceWatcher = fs.watch(projectRoot, { recursive: true }, (_eventType, filename) => {
      if (filename === null) {
        scheduleFallbackScan();
        return;
      }
      const relativePath = Buffer.isBuffer(filename) ? filename.toString() : String(filename);
      if (!relativePath || isIgnored(relativePath)) return;

      pendingSourcePaths.add(relativePath);
      clearTimeout(sourceEventTimer);
      sourceEventTimer = setTimeout(() => {
        flushSourceChanges().catch((error) => {
          statusState.lastError = error.message;
          console.error('[process-host] failed to inspect source changes:', error);
          updateTray();
        });
      }, 180);
    });
    sourceWatcher.on('error', (error) => {
      console.error('[process-host] source watcher failed; enabling fallback scan:', error);
      sourceWatcher.close();
      sourceWatcher = null;
      scheduleFallbackScan();
    });
  } catch (error) {
    console.error('[process-host] source watcher unavailable; enabling fallback scan:', error);
    scheduleFallbackScan();
  }
}

function scheduleFallbackScan() {
  if (fallbackScanTimer) return;
  fallbackScanTimer = setInterval(() => {
    scanChanges().catch((error) => {
      statusState.lastError = error.message;
      console.error('[process-host] fallback scan failed:', error);
      updateTray();
    });
  }, 60000);
  fallbackScanTimer.unref();
}

async function scanChanges() {
  const next = await createSnapshot();
  const changed = new Map();
  for (const [file, hash] of next) {
    if (!snapshot.has(file)) changed.set(file, 'added');
    else if (snapshot.get(file) !== hash) changed.set(file, 'changed');
  }
  for (const file of snapshot.keys()) {
    if (!next.has(file)) changed.set(file, 'deleted');
  }

  const entries = [...changed].map(([file, type]) => ({
    path: file.replace(/\\/g, '/'),
    type,
    category: classify(file),
  }));
  snapshot = next;
  commitChanges(entries);
}

function mergeChanges(existing, entries) {
  const merged = new Map(existing.map((item) => [item.path, item]));
  for (const item of entries) merged.set(item.path, item);
  return [...merged.values()];
}

async function configurePaths() {
  const { default: paths } = await import(pathToFileUrl(path.join(__dirname, 'paths.js')));
  paths();
}

function pathToFileUrl(filePath) {
  return require('url').pathToFileURL(filePath).href;
}

async function buildOmniscience() {
  await configurePaths();
  const { default: viteBuild } = await import(pathToFileUrl(path.join(__dirname, 'vite_build.js')));
  await viteBuild();
}

async function buildAndReload() {
  if (statusState.busy) return { ok: false, error: 'Host is already busy' };
  setBusy('Сборка componentapps и webapps...');
  try {
    await buildOmniscience();
    const buildable = new Set(['componentapps', 'webapps', 'extensions', 'renderer']);
    statusState.changed = statusState.changed.filter((item) =>
      !buildable.has(item.category));
    statusState.lastError = null;
    setBusy(null);
    reloadRenderers();
    updateTray();
    return { ok: true };
  } catch (error) {
    statusState.lastError = error.message;
    setBusy(null);
    return { ok: false, error: error.message };
  }
}

async function applyChanges() {
  if (statusState.busy) return { ok: false, error: 'Host is already busy' };
  setBusy('Применение изменений...');
  try {
    await buildOmniscience();
    const hasMainChanges = statusState.changed.some((item) => requiresFullRestart(item.path));
    statusState.lastError = null;
    setBusy(null);
    if (hasMainChanges) {
      await restartOmniscience(true);
    } else {
      statusState.changed = [];
      reloadRenderers();
    }
    updateTray();
    return { ok: true };
  } catch (error) {
    statusState.lastError = error.message;
    setBusy(null);
    return { ok: false, error: error.message };
  }
}

function reloadRenderers() {
  if (child && child.connected) {
    child.send({ type: 'reload-renderers' });
  }
  return { ok: true };
}

async function runHostAction(action) {
  if (action === 'apply') return applyChanges();
  if (action === 'reload') return reloadRenderers();
  if (action === 'restart') return restartOmniscience();
  if (action === 'close') {
    setImmediate(() => app.quit());
    return { ok: true };
  }
  if (action === 'open-project') {
    const error = await shell.openPath(projectRoot);
    return error ? { ok: false, error } : { ok: true };
  }
  return { ok: false, error: 'Неизвестное действие хоста' };
}

async function restartOmniscience(skipBuild = false) {
  if (statusState.busy && statusState.busy !== 'Перезапуск Omniscience...') {
    return { ok: false, error: 'Host is already busy' };
  }
  setBusy('Перезапуск Omniscience...');
  if (!skipBuild) {
    try {
      await buildOmniscience();
    } catch (error) {
      statusState.lastError = error.message;
      setBusy(null);
      return { ok: false, error: error.message };
    }
  }
  intentionalChildStop = true;
  if (child) {
    try { child.kill(); } catch {}
    child = null;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  startChild();
  statusState.changed = [];
  statusState.lastError = null;
  snapshot = await createSnapshot();
  setBusy(null);
  return { ok: true };
}

function startChild() {
  intentionalChildStop = false;
  child = spawn(electronExecutable, [projectRoot], {
    cwd: projectRoot,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
    env: {
      ...process.env,
      OMNISCIENCE_HOST_CHILD: '1',
    },
  });
  statusState.childPid = child.pid || null;
  child.on('message', (message) => {
    if (message?.type === 'omniscience-ready') updateTray();
    if (message?.type === 'host-action') {
      const requestChild = child;
      const respond = (result) => {
        if (!requestChild?.connected) return;
        try {
          requestChild.send({
            type: 'host-action-result',
            requestId: message.requestId,
            result,
          });
        } catch (error) {
          console.error('[process-host] failed to return action result:', error.message);
        }
      };
      runHostAction(message.action).then(respond, (error) => {
        respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    }
  });
  child.on('error', (error) => {
    statusState.lastError = error.message;
    setBusy(null);
  });
  child.on('exit', (code, signal) => {
    statusState.childPid = null;
    if (!intentionalChildStop && !quitting) {
      statusState.lastError = `Omniscience exited (${code ?? signal ?? 'unknown'})`;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(startChild, 1500);
    }
  });
  updateTray();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    const icon = nativeImage.createFromPath(path.join(projectRoot, 'icon.ico'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('Omniscience Development Host');
    tray.on('click', showTrayMenu);
    updateTray();

    snapshot = await createSnapshot();
    startSourceWatcher();

    startChild();
  });
}

app.on('before-quit', () => {
  quitting = true;
  intentionalChildStop = true;
  if (fallbackScanTimer) clearInterval(fallbackScanTimer);
  if (sourceWatcher) sourceWatcher.close();
  if (restartTimer) clearTimeout(restartTimer);
  if (changeTimer) clearTimeout(changeTimer);
  if (sourceEventTimer) clearTimeout(sourceEventTimer);
  if (child) {
    try { child.kill(); } catch {}
  }
  if (tray) tray.destroy();
});
