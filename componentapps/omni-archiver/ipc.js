import electronPkg from 'electron';
const { ipcMain, dialog, BrowserWindow } = electronPkg;
import path from 'path';
import os from 'os';
import fs from 'fs';
import fsp from 'fs/promises';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import { runPipeline } from './pipeline.js';
import { readClipboard } from './clipboard.js';
import { enumeratePaths } from './enumerate.js';
import { extractVhdFromFragments, extractFilesFromVhd } from './unpack.js';

// ⚠️ Должно совпадать с реальным именем папки компонента
const APP_DIR_NAME = 'omni-archiver';

let activeJob = null;
const sessionTempDir = path.join(os.tmpdir(), `omni-archiver-${process.pid}`);
fs.mkdirSync(sessionTempDir, { recursive: true });

function isArchiverFrame(event) {
  if (event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const rawUrl = event.sender.getURL();
    const url = new URL(rawUrl);
    url.search = '';
    url.hash = '';

    // 1. Строгое сравнение (эталон)
    const distDir = global.paths?.distDir;
    if (distDir) {
      const expectedUrl = pathToFileURL(
        path.join(distDir, 'componentapps', APP_DIR_NAME, 'index.html'),
      ).href;
      if (url.href === expectedUrl) return true;
    }

    // 2. Толерантное сравнение (dev, shell, кастомные протоколы)
    const normalized = decodeURIComponent(url.pathname)
      .replace(/\\/g, '/')
      .toLowerCase();
    const suffix = `/componentapps/${APP_DIR_NAME}/index.html`.toLowerCase();
    if (normalized.endsWith(suffix)) return true;

    // 3. Диагностика
    console.error('[omni-archiver] isArchiverFrame mismatch:', {
      rawUrl,
      normalizedUrl: url.href,
      distDir,
      expectedSuffix: suffix,
    });
    return false;
  } catch (e) {
    console.error('[omni-archiver] isArchiverFrame error:', e);
    return false;
  }
}

async function cleanupSessionTemp() {
  try { await fsp.rm(sessionTempDir, { recursive: true, force: true }); } catch {}
  try { fs.mkdirSync(sessionTempDir, { recursive: true }); } catch {}
}

export default function () {
  ipcMain.handle('omni-archiver:select-output-dir', async (event) => {
    if (!isArchiverFrame(event)) return { ok: false, error: 'unauthorized' };
    const parent = BrowserWindow.fromWebContents(event.sender) || undefined;
    const r = await dialog.showOpenDialog(parent, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled) return { ok: false, error: 'cancelled' };
    return { ok: true, path: r.filePaths[0] };
  });

  ipcMain.handle('omni-archiver:select-folders', async (event) => {
    if (!isArchiverFrame(event)) return { ok: false, error: 'unauthorized' };
    const parent = BrowserWindow.fromWebContents(event.sender) || undefined;
    const r = await dialog.showOpenDialog(parent, {
      properties: ['openDirectory', 'multiSelections'],
    });
    if (r.canceled) return { ok: false, error: 'cancelled' };
    return { ok: true, paths: r.filePaths };
  });

  // Новый: валидация/создание пути, введённого вручную
  ipcMain.handle('omni-archiver:resolve-output-path', async (event, rawPath) => {
    if (!isArchiverFrame(event)) return { ok: false, error: 'unauthorized' };
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return { ok: false, error: 'Путь пуст' };
    }
    const p = path.resolve(rawPath.trim().replace(/^"|"$/g, ''));
    try {
      await fsp.mkdir(p, { recursive: true });
      const st = await fsp.stat(p);
      if (!st.isDirectory()) return { ok: false, error: 'Это не папка' };
      // Проверка на запись
      const probe = path.join(p, `.write-test-${crypto.randomUUID()}`);
      await fsp.writeFile(probe, '');
      await fsp.unlink(probe);
      return { ok: true, path: p };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('omni-archiver:read-clipboard', async (event) => {
    if (!isArchiverFrame(event)) return { ok: false, error: 'unauthorized' };
    try { return { ok: true, data: await readClipboard(sessionTempDir) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('omni-archiver:save-text-to-temp', async (event, text) => {
    if (!isArchiverFrame(event)) return { ok: false, error: 'unauthorized' };
    try {
      const p = path.join(sessionTempDir, `clip-${crypto.randomUUID()}.txt`);
      await fsp.writeFile(p, text, 'utf8');
      return { ok: true, path: p };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('omni-archiver:enumerate', async (event, paths) => {
    if (!isArchiverFrame(event)) return { ok: false, error: 'unauthorized' };
    try { return { ok: true, ...(await enumeratePaths(paths)) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('omni-archiver:start', async (event, options) => {
    if (!isArchiverFrame(event)) return { ok: false, error: 'unauthorized' };
    if (activeJob) return { ok: false, error: 'Уже выполняется другая задача' };

    const controller = new AbortController();
    activeJob = { controller, event };
    const send = (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('omni-archiver:progress', p);
    };

    try {
      const result = await runPipeline(options, send, controller.signal);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      activeJob = null;
      await cleanupSessionTemp();
    }
  });

  ipcMain.handle('omni-archiver:cancel', async (event) => {
    if (!isArchiverFrame(event)) return { ok: false };
    activeJob?.controller.abort();
    return { ok: true };
  });

  ipcMain.handle('omni-archiver:select-save-vhd', async (event) => {
    if (!isArchiverFrame(event)) return { ok: false, error: 'unauthorized' };
    const parent = BrowserWindow.fromWebContents(event.sender) || undefined;
    const r = await dialog.showSaveDialog(parent, {
      title: 'Сохранить VHD как...',
      defaultPath: 'archive.vhd',
      filters: [{ name: 'Virtual Hard Disk', extensions: ['vhd'] }]
    });
    if (r.canceled) return { ok: false, error: 'cancelled' };
    return { ok: true, path: r.filePath };
  });

  ipcMain.handle('omni-archiver:unpack-fragments', async (event, { firstFragment, outputVhd }) => {
    if (!isArchiverFrame(event)) return { ok: false, error: 'unauthorized' };
    if (activeJob) return { ok: false, error: 'Уже выполняется' };
    const controller = new AbortController();
    activeJob = { controller, event };
    const send = (p) => { if (!event.sender.isDestroyed()) event.sender.send('omni-archiver:progress', p); };
    try {
      await extractVhdFromFragments(firstFragment, outputVhd, send, controller.signal);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally { activeJob = null; }
  });

  ipcMain.handle('omni-archiver:unpack-vhd', async (event, { vhdPath, outputDir }) => {
    if (!isArchiverFrame(event)) return { ok: false, error: 'unauthorized' };
    if (activeJob) return { ok: false, error: 'Уже выполняется' };
    const controller = new AbortController();
    activeJob = { controller, event };
    const send = (p) => { if (!event.sender.isDestroyed()) event.sender.send('omni-archiver:progress', p); };
    try {
      await extractFilesFromVhd(vhdPath, outputDir, send, controller.signal);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally { activeJob = null; }
  });
}