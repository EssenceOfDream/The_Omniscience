import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startWindowsNativeHost } from './windows-native-host.mjs';
import { openEverything } from '../main/everythingSearch.js';
import { isWindowsUwpAppUserModelId, parseWindowsUwpApps } from '../main/windowsUwpApps.js';
import {
  findComponentAppEntry,
  getComponentAppHtml,
  listComponentAppSources,
} from '../main/componentapps.js';

const categories = ['componentapps', 'webapps', 'extensions'];
const execFileAsync = promisify(execFile);
const windowsUwpHostPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../main/windowsUwpHost.ps1',
);
const windowsSettingsCategories = Object.freeze({
  system: ['sysdm.cpl'],
  devices: ['printers'],
  network: ['ncpa.cpl'],
  personalization: ['/name', 'Microsoft.Personalization'],
  apps: ['appwiz.cpl'],
  accounts: ['/name', 'Microsoft.UserAccounts'],
  timeLanguage: ['intl.cpl'],
  gaming: ['joy.cpl'],
  accessibility: ['/name', 'Microsoft.EaseOfAccessCenter'],
  search: ['/name', 'Microsoft.IndexingOptions'],
  privacy: ['inetcpl.cpl'],
  update: ['/name', 'Microsoft.WindowsUpdate'],
});
export const DEFAULT_THEME_SETTINGS = Object.freeze({
  enabled: true,
  maxR: 128,
  maxG: 0,
  maxB: 128,
  targetAlpha: 0.25,
  textBrightness: 255,
  blurShadow: 8,
  shadowColor: '#ff00ff',
});

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

async function hasBuiltProgram(projectRoot, category, name) {
  const relativePath = path.join(category, name, 'index.html');
  return await isFile(path.join(projectRoot, 'public', 'omniscience', relativePath))
    || await isFile(path.join(projectRoot, 'dist', relativePath));
}

export function normalizeThemeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Omni Theme settings');
  }
  const settings = { ...DEFAULT_THEME_SETTINGS, ...value };
  if (typeof settings.enabled !== 'boolean'
    || !Number.isFinite(settings.maxR) || settings.maxR < 0 || settings.maxR > 255
    || !Number.isFinite(settings.maxG) || settings.maxG < 0 || settings.maxG > 255
    || !Number.isFinite(settings.maxB) || settings.maxB < 0 || settings.maxB > 255
    || !Number.isFinite(settings.targetAlpha) || settings.targetAlpha < 0 || settings.targetAlpha > 1
    || !Number.isFinite(settings.textBrightness) || settings.textBrightness < 0 || settings.textBrightness > 255
    || !Number.isFinite(settings.blurShadow) || settings.blurShadow < 0 || settings.blurShadow > 30
    || typeof settings.shadowColor !== 'string'
    || !/^#[\da-f]{6}$/i.test(settings.shadowColor)) {
    throw new Error('Invalid Omni Theme settings');
  }
  return {
    enabled: settings.enabled,
    maxR: settings.maxR,
    maxG: settings.maxG,
    maxB: settings.maxB,
    targetAlpha: settings.targetAlpha,
    textBrightness: settings.textBrightness,
    blurShadow: settings.blurShadow,
    shadowColor: settings.shadowColor,
  };
}

function injectTheme(html, settings) {
  const serializedSettings = JSON.stringify(JSON.stringify(settings));
  const themeMarkup = `<link rel="stylesheet" href="/__omniscience/theme/base.css">`
    + `<script>localStorage.setItem('__omni_settings__',${serializedSettings});</script>`
    + `<script src="/__omniscience/theme/content.js"></script>`;
  const headEnd = /<\/head\s*>/i;
  return headEnd.test(html)
    ? html.replace(headEnd, `${themeMarkup}</head>`)
    : `${themeMarkup}${html}`;
}

function absoluteDirectory(payload) {
  const requestedPath = payload?.path;
  if (typeof requestedPath !== 'string' || !path.isAbsolute(requestedPath)) {
    throw new Error('An absolute directory path is required');
  }
  return path.resolve(requestedPath);
}

function safeEntryName(value) {
  if (typeof value !== 'string') throw new Error('A name is required');
  const name = value.trim();
  if (!name || name === '.' || name === '..'
    || path.basename(name) !== name
    || /[<>:"/\\|?*\u0000-\u001f]/.test(name)) {
    throw new Error('Invalid file or folder name');
  }
  return name;
}

async function getEntry(filePath, name) {
  const info = await lstat(filePath);
  const kind = info.isDirectory()
    ? 'directory'
    : info.isFile()
      ? 'file'
      : info.isSymbolicLink()
        ? 'symlink'
        : 'other';
  return {
    name,
    path: filePath,
    kind,
    size: info.size,
    modifiedAt: info.mtimeMs,
  };
}

export async function listDirectory(payload) {
  const directory = absoluteDirectory(payload);
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error('Path is not a directory');
  const names = await readdir(directory);
  const entries = await Promise.all(names.map((name) =>
    getEntry(path.join(directory, name), name)));
  entries.sort((left, right) =>
    Number(right.kind === 'directory') - Number(left.kind === 'directory')
    || left.name.localeCompare(right.name));
  return { path: directory, entries };
}

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

export async function getUserDirectories() {
  const home = os.homedir();
  const desktop = path.join(home, 'Desktop');
  const oneDriveDesktop = process.env.OneDrive
    ? path.join(process.env.OneDrive, 'Desktop')
    : null;
  const desktopPath = await isDirectory(desktop)
    ? desktop
    : oneDriveDesktop && await isDirectory(oneDriveDesktop)
      ? oneDriveDesktop
      : desktop;
  return {
    home,
    desktop: desktopPath,
    download: path.join(home, 'Downloads'),
    documents: path.join(home, 'Documents'),
    pictures: path.join(home, 'Pictures'),
    music: path.join(home, 'Music'),
    videos: path.join(home, 'Videos'),
  };
}

function absoluteComponentappPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('An absolute file path is required');
  }
  return path.resolve(value);
}

async function getChonkyFolders(projectRoot, platform) {
  const dirs = await getUserDirectories();
  const folders = [
    { id: 'project', name: 'The Omniscience', path: projectRoot },
    { id: 'home', name: 'Домашняя папка', path: dirs.home },
    { id: 'downloads', name: 'Загрузки', path: dirs.download },
    { id: 'pictures', name: 'Картинки', path: dirs.pictures },
    { id: 'documents', name: 'Документы', path: dirs.documents },
    { id: 'music', name: 'Музыка', path: dirs.music },
    { id: 'videos', name: 'Видео', path: dirs.videos },
  ];
  folders.unshift(platform === 'win32'
    ? { id: 'c_root', name: 'Диск C:', path: path.parse(projectRoot).root || 'C:\\' }
    : { id: 'root', name: 'Корень ФС', path: path.parse(projectRoot).root || '/' });
  return folders;
}

async function invokeComponentappIpc(payload, context) {
  const appId = payload?.appId;
  const channel = payload?.channel;
  const args = payload?.args;
  const projectRoot = typeof context === 'string' ? context : context.projectRoot;
  if (typeof appId !== 'string' || typeof channel !== 'string' || !Array.isArray(args)) {
    throw new Error('Componentapp id, channel, and arguments are required');
  }

  if (appId === 'Chonky') {
    if (channel === 'get-default-folders') {
      return getChonkyFolders(
        projectRoot,
        typeof context === 'string' ? process.platform : context.platform ?? process.platform,
      );
    }
    if (channel === 'get-files') {
      const directory = absoluteDirectory({ path: args[0] });
      try {
        const entries = await readdir(directory, { withFileTypes: true });
        const files = await Promise.all(entries.map(async (entry) => {
          const entryPath = path.join(directory, entry.name);
          const info = await stat(entryPath);
          return {
            id: entryPath,
            name: entry.name,
            isDir: info.isDirectory(),
            size: info.size,
            modDate: info.mtime.toISOString(),
          };
        }));
        return { success: true, files };
      } catch (error) {
        return {
          success: false,
          error: error.code === 'EACCES' || error.code === 'EPERM'
            ? 'permission_denied'
            : 'unknown',
        };
      }
    }
  }

  if (appId === 'Monaco') {
    if (channel === 'read-file') {
      const filePath = absoluteComponentappPath(args[0]);
      try {
        return { success: true, content: await readFile(filePath, 'utf8') };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    if (channel === 'write-file') {
      const filePath = absoluteComponentappPath(args[0]);
      if (typeof args[1] !== 'string') throw new Error('File content must be a string');
      try {
        await writeFile(filePath, args[1], 'utf8');
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
    if (channel === 'get-default-folders') {
      return getChonkyFolders(
        projectRoot,
        typeof context === 'string' ? process.platform : context.platform ?? process.platform,
      );
    }
    if (channel === 'check-text-file') {
      const filePath = absoluteComponentappPath(args[0]);
      let file;
      try {
        file = await open(filePath, 'r');
        const buffer = Buffer.alloc(4096);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        return !buffer.subarray(0, bytesRead).includes(0);
      } catch {
        return false;
      } finally {
        await file?.close();
      }
    }
  }

  throw new Error(`Unsupported legacy IPC channel ${channel} for componentapp ${appId}`);
}

function mediaKind(name) {
  const extension = path.extname(name).slice(1).toLowerCase();
  if (['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'].includes(extension)) {
    return 'image';
  }
  if (['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'ogv', 'flv', 'wmv', 'mpg', 'mpeg'].includes(extension)) {
    return 'video';
  }
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'wma', 'aiff', 'alac'].includes(extension)) {
    return 'audio';
  }
  return null;
}

function getWindowsNativeHost(context) {
  if (typeof context === 'string') {
    throw new Error('Windows hidden-window support is unavailable in this request context');
  }
  if ((context.platform ?? process.platform) !== 'win32') {
    throw new Error('The hidden-windows panel is only supported on Windows');
  }
  if (!context.nativeWindowHost) {
    context.nativeWindowHost = startWindowsNativeHost(context.projectRoot);
  }
  return context.nativeWindowHost;
}

async function getNativeWindows(context) {
  const nativeHost = getWindowsNativeHost(context);
  const result = await nativeHost.request('list', {
    ownPid: context.nativeWindowOwnPid ?? process.pid,
  });
  return Array.isArray(result) ? result : result ? [result] : [];
}

function mapNativeWindow(window) {
  return {
    id: String(window.id),
    title: window.title || window.processName || 'Окно',
    processName: path.basename(window.imagePath || '').replace(/\.[^.]+$/, '') || null,
    pid: Number(window.pid) || null,
    minimized: Boolean(window.minimized),
    maximized: Boolean(window.maximized),
    focused: Boolean(window.focused),
  };
}

async function listHiddenWindows(context) {
  const windows = await getNativeWindows(context);
  return windows
    .filter((window) => window.taskbarHidden === true)
    .map(mapNativeWindow)
    .sort((left, right) =>
      (left.processName || left.title).localeCompare(right.processName || right.title)
      || left.title.localeCompare(right.title));
}

async function listNativeWindows(context) {
  const windows = await getNativeWindows(context);
  return windows
    .filter((window) => window.visible === true && window.taskbarHidden !== true)
    .map((window) => ({
      ...mapNativeWindow(window),
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
    }))
    .sort((left, right) =>
      Number(right.focused) - Number(left.focused)
      || (left.processName || left.title).localeCompare(right.processName || right.title)
      || left.title.localeCompare(right.title));
}

async function manageHiddenWindow(payload, context) {
  const id = payload?.id;
  const action = payload?.action;
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) {
    throw new Error('A valid hidden-window id is required');
  }
  if (!['focus', 'minimize', 'maximize', 'close'].includes(action)) {
    throw new Error('Unsupported hidden-window action');
  }

  const nativeHost = getWindowsNativeHost(context);
  const windows = await listHiddenWindows(context);
  const target = windows.find((window) => window.id === id);
  if (!target) throw new Error('The hidden window is no longer available');

  const result = await nativeHost.request(action, {
    hwnd: id,
    ...(action === 'maximize' ? { maximize: !target.maximized } : {}),
  });
  if (result !== true) throw new Error(`Could not ${action} hidden window ${id}`);
  return { success: true };
}

async function manageNativeWindow(payload, context) {
  const id = payload?.id;
  const action = payload?.action;
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) {
    throw new Error('A valid native-window id is required');
  }
  if (!['focus', 'minimize', 'maximize', 'close'].includes(action)) {
    throw new Error('Unsupported native-window action');
  }

  const nativeHost = getWindowsNativeHost(context);
  const windows = await listNativeWindows(context);
  const target = windows.find((window) => window.id === id);
  if (!target) throw new Error('The native window is no longer available');

  const result = await nativeHost.request(action, {
    hwnd: id,
    ...(action === 'maximize' ? { maximize: !target.maximized } : {}),
  });
  if (result !== true) throw new Error(`Could not ${action} native window ${id}`);
  return { success: true };
}

async function getExplorerShellStatus(context) {
  const nativeHost = getWindowsNativeHost(context);
  return nativeHost.request('explorer-shell-status');
}

async function setShellWindowLayer(payload, context) {
  const hwnd = payload?.hwnd;
  const layer = payload?.layer;
  if (typeof hwnd !== 'string' || !/^[1-9]\d*$/.test(hwnd)) {
    throw new Error('A valid shell window handle is required');
  }
  if (layer !== 'desktop' && layer !== 'top') {
    throw new Error('Unsupported shell window layer');
  }

  const nativeHost = getWindowsNativeHost(context);
  const action = layer === 'desktop' ? 'desktop-bottom' : 'z-order';
  const result = await nativeHost.request(action, {
    hwnd,
    ...(layer === 'top' ? { layer } : {}),
  });
  if (result !== true) throw new Error(`Could not place shell window in the ${layer} layer`);
  return true;
}

async function setShellPanelDock(payload, context) {
  const { hwnd, x, y, width, height } = payload ?? {};
  if (typeof hwnd !== 'string' || !/^[1-9]\d*$/.test(hwnd)) {
    throw new Error('A valid shell panel handle is required');
  }
  if (![x, y, width, height].every(Number.isSafeInteger)
    || width <= 0 || height <= 0) {
    throw new Error('Valid shell panel bounds are required');
  }

  const result = await getWindowsNativeHost(context).request('dock', {
    hwnd,
    x,
    y,
    width,
    height,
    edge: 'top',
  });
  if (result !== true) throw new Error('Could not reserve the shell panel work area');
  return true;
}

async function removeShellPanelDock(payload, context) {
  const hwnd = payload?.hwnd;
  if (typeof hwnd !== 'string' || !/^[1-9]\d*$/.test(hwnd)) {
    throw new Error('A valid shell panel handle is required');
  }
  const result = await getWindowsNativeHost(context).request('dock-remove', { hwnd });
  if (result !== true) throw new Error('Could not release the shell panel work area');
  return true;
}

export async function readDesktopDirectory(payload) {
  try {
    const listing = await listDirectory({ path: payload?.path });
    return {
      success: true,
      files: listing.entries.map((entry) => ({
        id: entry.path,
        name: entry.name,
        displayName: entry.name,
        isDir: entry.kind === 'directory',
        mediaKind: entry.kind === 'file' ? mediaKind(entry.name) : null,
        fileUrl: null,
        iconPath: null,
        infoTip: null,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
      })),
      directoryMetadata: null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.code === 'EACCES' || error.code === 'EPERM'
        ? 'permission_denied'
        : error.message,
    };
  }
}

export async function createEntry(payload, kind) {
  const parentPath = absoluteDirectory({ path: payload?.parentPath });
  const name = safeEntryName(payload?.name);
  const parentInfo = await stat(parentPath);
  if (!parentInfo.isDirectory()) throw new Error('Parent path is not a directory');
  const targetPath = path.join(parentPath, name);

  if (kind === 'folder') {
    await mkdir(targetPath);
  } else {
    const handle = await open(targetPath, 'wx');
    await handle.close();
  }
  return { path: targetPath };
}

export async function renameEntry(payload) {
  const sourcePath = payload?.path;
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    throw new Error('An absolute source path is required');
  }
  const resolvedSource = path.resolve(sourcePath);
  const name = safeEntryName(payload?.name);
  const targetPath = path.join(path.dirname(resolvedSource), name);
  if (resolvedSource === targetPath) return { path: resolvedSource };

  try {
    await lstat(targetPath);
    throw new Error('EEXIST');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await rename(resolvedSource, targetPath);
  return { path: targetPath };
}

export function openWindowsSettingsCategory(payload, context = {}) {
  const platform = context.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new Error('Windows settings are only available on Windows');
  }
  const category = payload?.category;
  if (typeof category !== 'string'
    || !Object.prototype.hasOwnProperty.call(windowsSettingsCategories, category)) {
    throw new Error('Windows settings category was not found');
  }

  const controlPath = path.join(
    context.windir ?? process.env.WINDIR ?? 'C:\\Windows',
    'System32',
    'control.exe',
  );
  const spawnProcess = context.spawn ?? spawn;
  return new Promise((resolve, reject) => {
    const child = spawnProcess(controlPath, windowsSettingsCategories[category], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}

async function collectStartMenuShortcuts(directory, apps, seen) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return;
    throw error;
  }

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectStartMenuShortcuts(filePath, apps, seen);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!entry.isFile() || (extension !== '.lnk' && extension !== '.url')) continue;
    const id = `native:${filePath.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    apps.push({
      id,
      name: path.basename(entry.name, extension),
      launchType: 'shortcut',
      launchTarget: filePath,
    });
  }
}

async function listNativeApps(context = {}) {
  const platform = typeof context === 'string'
    ? process.platform
    : context.platform ?? process.platform;
  if (platform !== 'win32') return [];
  if (typeof context !== 'string' && Array.isArray(context.nativeApps)) {
    return context.nativeApps;
  }

  const home = os.homedir();
  const startMenuRelativePath = path.join('Microsoft', 'Windows', 'Start Menu', 'Programs');
  const startMenuDirectories = [
    path.join(
      context.appData ?? process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
      startMenuRelativePath,
    ),
    path.join(context.programData ?? process.env.ProgramData ?? 'C:\\ProgramData', startMenuRelativePath),
  ];
  const apps = [];
  const seen = new Set();
  for (const directory of startMenuDirectories) {
    await collectStartMenuShortcuts(directory, apps, seen);
  }

  const systemRoot = context.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows';
  const powershellPath = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const runPowerShell = context.execFileAsync ?? execFileAsync;
  const { stdout } = await runPowerShell(powershellPath, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    windowsUwpHostPath,
    '-Action',
    'List',
  ], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  for (const app of parseWindowsUwpApps(stdout)) {
    apps.push({
      id: `native:uwp:${app.appUserModelId.toLowerCase()}`,
      name: app.title,
      launchType: 'uwp',
      launchTarget: app.appUserModelId,
    });
  }

  apps.sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  if (typeof context !== 'string') context.nativeApps = apps;
  return apps;
}

async function launchNativeApp(payload, context = {}) {
  const platform = typeof context === 'string'
    ? process.platform
    : context.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new Error('Launching Windows apps is only supported on Windows');
  }
  const id = payload?.id;
  if (typeof id !== 'string') throw new Error('A Windows app id is required');

  const app = (await listNativeApps(context)).find((candidate) => candidate.id === id);
  if (!app) throw new Error('Windows app is no longer available');

  if (app.launchType === 'uwp') {
    const appUserModelId = app.launchTarget;
    if (!isWindowsUwpAppUserModelId(appUserModelId)) {
      throw new Error('Invalid packaged application id');
    }
    const systemRoot = context.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows';
    const powershellPath = path.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const runPowerShell = context.execFileAsync ?? execFileAsync;
    await runPowerShell(powershellPath, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      windowsUwpHostPath,
      '-Action',
      'Launch',
      '-AppId',
      appUserModelId,
    ], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    return { opened: true };
  }

  const explorerPath = path.join(
    context.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows',
    'explorer.exe',
  );
  const spawnProcess = context.spawn ?? spawn;
  await new Promise((resolve, reject) => {
    const child = spawnProcess(explorerPath, [app.launchTarget], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
  return { opened: true };
}

export async function startFileServer(
  distRoot,
  getThemeSettings = () => DEFAULT_THEME_SETTINGS,
) {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch {
      response.writeHead(400).end('Invalid URL');
      return;
    }

    const filePath = path.resolve(distRoot, `.${pathname}`);
    const relativePath = path.relative(distRoot, filePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }

      const contentType = contentTypes.get(path.extname(filePath).toLowerCase())
        || 'application/octet-stream';
      let body = null;
      let contentLength = info.size;
      if (contentType.startsWith('text/html')) {
        body = injectTheme(await readFile(filePath, 'utf8'), getThemeSettings());
        contentLength = Buffer.byteLength(body);
      }

      response.writeHead(200, {
        'Content-Length': contentLength,
        'Content-Type': contentTypes.get(path.extname(filePath).toLowerCase())
          || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      if (body !== null) {
        response.end(body);
      } else {
        createReadStream(filePath).pipe(response);
      }
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(500).end('Could not read requested file');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Node.js file server did not bind to a TCP port');
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

export async function listPrograms(projectRoot, platform = process.platform) {
  const programs = [];

  for (const category of categories) {
    if (category === 'componentapps') {
      for (const app of listComponentAppSources(projectRoot)) {
        const hasEntry = Boolean(getComponentAppHtml(app) || findComponentAppEntry(app));
        const built = hasEntry && await hasBuiltProgram(projectRoot, category, app.name);
        programs.push({
          id: `${category}:${app.name}`,
          name: app.name,
          category,
          entryPoint: hasEntry ? path.join(category, app.name, 'index.html') : null,
          launchable: built && (app.name !== 'windows-settings' || platform === 'win32'),
        });
      }
      continue;
    }

    const categoryPath = path.join(projectRoot, category);
    let entries;
    try {
      entries = await readdir(categoryPath, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('PASTE ')) continue;

      const directory = path.join(categoryPath, entry.name);
      const indexPath = path.join(directory, 'index.html');
      let entryPoint = null;
      try {
        if ((await stat(indexPath)).isFile()) {
          entryPoint = path.join(category, entry.name, 'index.html');
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      programs.push({
        id: `${category}:${entry.name}`,
        name: entry.name,
        category,
        entryPoint,
        launchable: category === 'webapps' && await hasBuiltProgram(projectRoot, category, entry.name),
      });
    }
  }

  return programs.sort((left, right) =>
    left.category.localeCompare(right.category) || left.name.localeCompare(right.name));
}

async function getProgramIcon(projectRoot, category, name) {
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

async function getHomepageUrl(projectRoot) {
  try {
    const config = JSON.parse(await readFile(path.join(projectRoot, 'config.json'), 'utf8'));
    return typeof config.homepageUrl === 'string' ? config.homepageUrl : '';
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

async function getOverviewApps(projectRoot, platform) {
  const homepageUrl = await getHomepageUrl(projectRoot);
  const apps = [{
    id: 'new-browser-window',
    type: 'browser',
    title: 'Браузер',
    url: homepageUrl || null,
    icon: null,
    launchable: Boolean(homepageUrl),
  }];
  const programs = await listPrograms(projectRoot, platform);

  for (const program of programs) {
    if (program.category !== 'componentapps' && program.category !== 'webapps') continue;
    if (!await hasBuiltProgram(projectRoot, program.category, program.name)) continue;

    apps.push({
      id: program.name,
      type: program.category === 'componentapps' ? 'componentapp' : 'webapp',
      title: program.name,
      url: `/omniscience/${program.category}/${encodeURIComponent(program.name)}/index.html`,
      icon: await getProgramIcon(projectRoot, program.category, program.name),
      launchable: program.launchable,
      preloadPath: null,
    });
  }
  return apps;
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

export async function handleRequest(request, context) {
  const projectRoot = typeof context === 'string' ? context : context.projectRoot;
  if (request?.method === 'health') {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      projectRoot,
      fileServerUrl: typeof context === 'string' ? null : context.fileServerUrl,
    };
  }
  if (request?.method === 'get-apps-list') {
    return getOverviewApps(
      projectRoot,
      typeof context === 'string' ? process.platform : context.platform ?? process.platform,
    );
  }
  if (request?.method === 'componentapp-ipc') {
    return invokeComponentappIpc(request.payload, context);
  }
  if (request?.method === 'list-programs') {
    return listPrograms(
      projectRoot,
      typeof context === 'string' ? process.platform : context.platform ?? process.platform,
    );
  }
  if (request?.method === 'list-native-apps') {
    const apps = await listNativeApps(context);
    return apps.map(({ id, name, launchType }) => ({
      id,
      name,
      category: 'native',
      entryPoint: null,
      launchable: true,
      launchType,
    }));
  }
  if (request?.method === 'launch-native-app') {
    return launchNativeApp(request.payload, context);
  }
  if (request?.method === 'set-theme') {
    if (typeof context === 'string') {
      throw new Error('Theme settings are unavailable in this request context');
    }
    context.themeSettings = normalizeThemeSettings(request.payload);
    return context.themeSettings;
  }
  if (request?.method === 'get-theme') {
    if (typeof context === 'string') {
      throw new Error('Theme settings are unavailable in this request context');
    }
    return context.themeSettings ?? { ...DEFAULT_THEME_SETTINGS };
  }
  if (request?.method === 'open-program') {
    if (request.payload?.programId === 'new-browser-window') {
      const homepageUrl = await getHomepageUrl(projectRoot);
      if (!homepageUrl) throw new Error('A homepage URL is not configured');
      return {
        kind: 'webapp',
        name: 'Браузер',
        url: homepageUrl,
        themeSettings: typeof context === 'string'
          ? { ...DEFAULT_THEME_SETTINGS }
          : context.themeSettings ?? { ...DEFAULT_THEME_SETTINGS },
      };
    }
    const programs = await listPrograms(
      projectRoot,
      typeof context === 'string' ? process.platform : context.platform ?? process.platform,
    );
    const requestedId = request.payload?.programId;
    const program = typeof requestedId === 'string'
      ? programs.find((item) =>
        item.id === requestedId
        || item.name === requestedId
        || item.entryPoint === requestedId)
      : null;
    if (!program) throw new Error('Program not found');
    if (!program.launchable) throw new Error('This program is not migrated to Tauri yet');
    if (program.category === 'componentapps') {
      return {
        kind: 'componentapp',
        name: program.name,
        appPath: path.posix.join(
          'omniscience',
          program.category,
          program.name,
          'index.html',
        ),
        themeSettings: typeof context === 'string'
          ? { ...DEFAULT_THEME_SETTINGS }
          : context.themeSettings ?? { ...DEFAULT_THEME_SETTINGS },
      };
    }
    if (!context.fileServerUrl) throw new Error('Local app server is unavailable');

    return {
      kind: 'webapp',
      name: program.name,
      url: `${context.fileServerUrl}/${program.category}/${encodeURIComponent(program.name)}/index.html`,
    };
  }
  if (request?.method === 'list-directory') {
    return listDirectory(request.payload);
  }
  if (request?.method === 'get-user-dirs') {
    return getUserDirectories();
  }
  if (request?.method === 'read-desktop-directory') {
    return readDesktopDirectory(request.payload);
  }
  if (request?.method === 'list-hidden-windows') {
    return listHiddenWindows(context);
  }
  if (request?.method === 'list-native-windows') {
    return listNativeWindows(context);
  }
  if (request?.method === 'manage-hidden-window') {
    return manageHiddenWindow(request.payload, context);
  }
  if (request?.method === 'manage-native-window') {
    return manageNativeWindow(request.payload, context);
  }
  if (request?.method === 'open-windows-settings-category') {
    return openWindowsSettingsCategory(request.payload, context);
  }
  if (request?.method === 'explorer-shell-status') {
    return getExplorerShellStatus(context);
  }
  if (request?.method === 'set-shell-window-layer') {
    return setShellWindowLayer(request.payload, context);
  }
  if (request?.method === 'set-shell-panel-dock') {
    return setShellPanelDock(request.payload, context);
  }
  if (request?.method === 'remove-shell-panel-dock') {
    return removeShellPanelDock(request.payload, context);
  }
  if (request?.method === 'open-everything') {
    if ((typeof context === 'string' ? process.platform : context.platform) !== 'win32') {
      throw new Error('Everything search is only available on Windows');
    }
    await openEverything();
    return { opened: true };
  }
  if (request?.method === 'create-folder') {
    return createEntry(request.payload, 'folder');
  }
  if (request?.method === 'create-file') {
    return createEntry(request.payload, 'file');
  }
  if (request?.method === 'rename-path') {
    return renameEntry(request.payload);
  }
  if (request?.method === 'parent-directory') {
    const directory = absoluteDirectory(request.payload);
    return path.dirname(directory);
  }
  throw new Error(`Unknown Node.js sidecar method: ${request?.method}`);
}

async function main() {
  const projectRoot = process.argv[2];
  if (!projectRoot) throw new Error('Project root argument is required');

  const context = {
    projectRoot,
    fileServerUrl: null,
    themeSettings: { ...DEFAULT_THEME_SETTINGS },
    platform: process.platform,
    nativeWindowOwnPid: Number.isSafeInteger(Number(process.argv[3]))
      && Number(process.argv[3]) > 0
      ? Number(process.argv[3])
      : process.pid,
  };
  const { server, baseUrl } = await startFileServer(
    path.join(projectRoot, 'public', 'omniscience'),
    () => context.themeSettings,
  );
  context.fileServerUrl = baseUrl;
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of input) {
      let request;
      try {
        request = JSON.parse(line);
        const result = await handleRequest(request, context);
        process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({
          id: request?.id ?? null,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })}\n`);
      }
    }
  } finally {
    context.nativeWindowHost?.close();
    server.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[tauri-node-sidecar]', error);
    process.exitCode = 1;
  });
}
