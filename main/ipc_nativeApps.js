import electronPkg from 'electron';
const { app, ipcMain, shell, nativeImage } = electronPkg;
import { readdir, readFile, access } from 'fs/promises';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { isWindowsUwpAppUserModelId, parseWindowsUwpApps } from './windowsUwpApps.js';
import {
  getWindowsShortcutIconCandidates,
  getWindowsShortcutIconSources,
  parseWindowsUrlShortcut,
} from './windowsShortcut.js';
import { extractWindowsIcons } from './windowsShortcutIcons.js';

const execFileAsync = promisify(execFile);
const WINDOWS_UWP_HOST_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'windowsUwpHost.ps1');
const POWERSHELL_PATH = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

/* ------------------------------------------------------------------ */
/* Где искать .desktop файлы                                           */
/* ------------------------------------------------------------------ */

const DESKTOP_DIRS = [
  '/usr/share/applications',
  '/usr/local/share/applications',
  path.join(os.homedir(), '.local/share/applications'),
  '/var/lib/flatpak/exports/share/applications',
  path.join(os.homedir(), '.local/share/flatpak/exports/share/applications'),
  '/var/lib/snapd/desktop/applications',
];

/* ------------------------------------------------------------------ */
/* Иконки                                                              */
/* ------------------------------------------------------------------ */

const ICON_DIRS = [
  '/usr/share/icons/hicolor',
  '/usr/share/icons/Adwaita',
  '/usr/share/icons/gnome',
  '/usr/share/icons/Papirus',
  '/usr/share/icons/Papirus-Dark',
  '/usr/share/icons/breeze',
  '/usr/share/icons/breeze-dark',
  path.join(os.homedir(), '.local/share/icons/hicolor'),
  '/var/lib/flatpak/exports/share/icons',
];

const ICON_SIZES = ['48x48', '64x64', '128x128', 'scalable', '32x32', '256x256', '512x512'];
const ICON_EXTS = ['png', 'svg', 'xpm'];

const ICON_CACHE = new Map();

async function fileToDataUri(filePath, ext) {
  try {
    const buf = await readFile(filePath);
    const mime = ext === 'svg' ? 'image/svg+xml'
      : ext === 'png' ? 'image/png'
      : 'image/x-xpixmap';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (_) {
    return null;
  }
}

async function findIconPath(iconName) {
  if (!iconName) return null;
  if (ICON_CACHE.has(iconName)) return ICON_CACHE.get(iconName);

  // 1. Абсолютный путь или file:// URI
  if (iconName.startsWith('/') || iconName.startsWith('file://')) {
    const p = iconName.replace(/^file:\/\//, '');
    const ext = path.extname(p).slice(1).toLowerCase();
    try {
      await access(p);
      const dataUri = await fileToDataUri(p, ext);
      ICON_CACHE.set(iconName, dataUri);
      return dataUri;
    } catch (_) {}
  }

  // 2. Поиск по имени в системных темах
  for (const baseDir of ICON_DIRS) {
    for (const size of ICON_SIZES) {
      for (const ext of ICON_EXTS) {
        const p = path.join(baseDir, size, 'apps', `${iconName}.${ext}`);
        try {
          await access(p);
          const dataUri = await fileToDataUri(p, ext);
          ICON_CACHE.set(iconName, dataUri);
          return dataUri;
        } catch (_) {}
      }
    }
  }

  ICON_CACHE.set(iconName, null);
  return null;
}

/* ------------------------------------------------------------------ */
/* Парсинг .desktop                                                    */
/* ------------------------------------------------------------------ */

function parseDesktopFile(content) {
  const lines = content.split('\n');
  let inEntry = false;
  const entry = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inEntry = line === '[Desktop Entry]';
      continue;
    }
    if (!inEntry) continue;
    if (line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    entry[key] = value;
  }
  return entry;
}

function getLocalizedName(entry) {
  const lang = (process.env.LC_MESSAGES || process.env.LANG || 'en').split('.')[0].split('_')[0];
  const candidates = [
    lang ? `Name[${lang}]` : null,
    'Name[ru]',
    'Name',
  ].filter(Boolean);

  for (const key of candidates) {
    if (entry[key]) return entry[key];
  }
  return entry.Name || '';
}

function cleanExec(exec) {
  // убираем параметры типа %U %F %u %f %i %c %k %d
  return exec
    .replace(/%[uUfFdDnNickvm]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Скан всех .desktop                                                  */
/* ------------------------------------------------------------------ */

let cachedNativeApps = null;

const DIRECT_ICON_EXTENSIONS = new Set(['.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

function getDirectIconDataUrl(filePath) {
  if (!DIRECT_ICON_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return null;
  const image = nativeImage.createFromPath(filePath);
  return image.isEmpty() ? null : image.toDataURL();
}

async function populateShortcutIcons(iconJobs) {
  const requests = [];
  const requestIds = new Map();
  for (const job of iconJobs) {
    job.requestIds = new Map();
    for (const source of job.sources) {
      try {
        await access(source.path);
      } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
          console.warn('[nativeApps] cannot access shortcut icon source:', source.path, err.message);
        }
        continue;
      }

      try {
        const directIcon = getDirectIconDataUrl(source.path);
        if (directIcon) {
          job.app.icon = directIcon;
          break;
        }
      } catch (err) {
        console.warn('[nativeApps] failed to read icon file:', source.path, err.message);
      }

      const sourceKey = `${source.path.toLowerCase()}|${source.iconIndex}`;
      let requestId = requestIds.get(sourceKey);
      if (requestId == null) {
        requestId = String(requests.length);
        requestIds.set(sourceKey, requestId);
        requests.push({ id: requestId, path: source.path, iconIndex: source.iconIndex });
      }
      job.requestIds.set(sourceKey, requestId);
    }
  }

  let extractedIcons = new Map();
  try {
    extractedIcons = await extractWindowsIcons(requests);
    const requestPaths = new Map(requests.map((request) => [request.id, request.path]));
    for (const [id, result] of extractedIcons) {
      if (result.error) {
        console.warn('[nativeApps] failed to extract icon resource:', requestPaths.get(id), result.error);
      }
    }
  } catch (err) {
    console.error('[nativeApps] Windows icon extraction failed:', err.message);
  }

  for (const job of iconJobs) {
    if (job.app.icon) continue;
    for (const source of job.sources) {
      const key = `${source.path.toLowerCase()}|${source.iconIndex}`;
      const result = extractedIcons.get(job.requestIds.get(key));
      if (result?.dataUrl) {
        job.app.icon = result.dataUrl;
        break;
      }
    }
    if (job.app.icon) continue;

    for (const candidate of job.fallbackCandidates) {
      try {
        await access(candidate);
        const image = await app.getFileIcon(candidate, { size: 'normal' });
        if (!image.isEmpty()) {
          job.app.icon = image.toDataURL();
          break;
        }
      } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
          console.warn('[nativeApps] failed to read shortcut icon:', candidate, err.message);
        }
      }
    }
  }
}

async function collectShortcuts(dir, result, seen, iconJobs) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
      console.warn('[nativeApps] cannot read Start Menu directory:', dir, err.message);
    }
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectShortcuts(fullPath, result, seen, iconJobs);
      continue;
    }
    const extension = path.extname(entry.name).toLowerCase();
    if (!entry.isFile() || (extension !== '.lnk' && extension !== '.url')) continue;

    const key = fullPath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let title = path.basename(entry.name, path.extname(entry.name));
    let shortcut = null;
    if (extension === '.lnk') {
      try {
        shortcut = shell.readShortcutLink(fullPath);
        title = shortcut.description || title;
      } catch { /* malformed or inaccessible shortcut */ }
    } else {
      try {
        shortcut = parseWindowsUrlShortcut(await readFile(fullPath), fullPath);
      } catch (err) {
        console.warn('[nativeApps] failed to read URL shortcut:', fullPath, err.message);
      }
    }

    const appEntry = {
      id: `native:${key}`,
      nativeId: fullPath,
      title,
      icon: null,
      kind: 'native',
      exec: fullPath,
      terminal: false,
      comment: '',
      categories: '',
      fullPath
    };
    result.push(appEntry);
    const sources = extension === '.url'
      ? (shortcut?.iconLocation ? [shortcut.iconLocation] : [])
      : getWindowsShortcutIconSources(fullPath, shortcut);
    iconJobs.push({
      app: appEntry,
      sources,
      fallbackCandidates: extension === '.url'
        ? [...sources.map((source) => source.path), fullPath]
        : getWindowsShortcutIconCandidates(fullPath, shortcut),
    });
  }
}

async function scanWindowsShortcuts() {
  const result = [];
  const seen = new Set();
  const iconJobs = [];
  const startMenu = path.join('Microsoft', 'Windows', 'Start Menu', 'Programs');
  const dirs = [
    path.join(app.getPath('appData'), startMenu),
    path.join(process.env.ProgramData || 'C:\\ProgramData', startMenu),
  ];
  for (const dir of dirs) await collectShortcuts(dir, result, seen, iconJobs);
  await populateShortcutIcons(iconJobs);

  try {
    const { stdout } = await execFileAsync(POWERSHELL_PATH, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', WINDOWS_UWP_HOST_PATH, '-Action', 'List',
    ], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    for (const app of parseWindowsUwpApps(stdout)) {
      result.push({
        id: `uwp:${app.appUserModelId.toLowerCase()}`,
        nativeId: app.appUserModelId,
        title: app.title,
        icon: null,
        kind: 'native',
        launchType: 'uwp',
        appUserModelId: app.appUserModelId,
        exec: null,
        terminal: false,
        comment: '',
        categories: '',
      });
    }
  } catch (err) {
    console.error('[nativeApps] failed to enumerate packaged Windows apps:', err.message);
  }

  return result;
}

async function scanDesktopFiles() {
  if (process.platform === 'win32') return scanWindowsShortcuts();

  const seen = new Set();
  const result = [];

  for (const dir of DESKTOP_DIRS) {
    let entries;
    try {
      entries = await readdir(dir);
    } catch (_) {
      continue;
    }

    for (const fileName of entries) {
      if (!fileName.endsWith('.desktop')) continue;
      if (seen.has(fileName)) continue;
      seen.add(fileName);

      const fullPath = path.join(dir, fileName);
      let content;
      try {
        content = await readFile(fullPath, 'utf-8');
      } catch (_) {
        continue;
      }

      const entry = parseDesktopFile(content);
      if (!entry.Name || !entry.Exec) continue;
      if (entry.NoDisplay === 'true') continue;
      if (entry.Hidden === 'true') continue;
      if (entry.Type && entry.Type !== 'Application') continue;
      if (entry.OnlyShowIn && !entry.OnlyShowIn.includes('KDE')) continue;
      if (entry.NotShowIn && entry.NotShowIn.includes('KDE')) continue;

      const title = getLocalizedName(entry);
      const iconName = entry.Icon || null;
      const icon = iconName ? await findIconPath(iconName) : null;

      result.push({
        id: `native:${fileName}`,
        nativeId: fileName,
        title,
        icon,
        kind: 'native',
        exec: cleanExec(entry.Exec),
        terminal: entry.Terminal === 'true',
        comment: entry.Comment || '',
        categories: entry.Categories || '',
        fullPath:fileName
      });
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

export default function () {
  ipcMain.handle('get-native-apps', async (_e, { force } = {}) => {
    if (cachedNativeApps && !force) return cachedNativeApps;
    cachedNativeApps = await scanDesktopFiles();
    return cachedNativeApps;
  });

  ipcMain.on('launch-native-app', async (_e, { exec, terminal, appUserModelId }) => {
    try {
      if (process.platform === 'win32') {
        if (appUserModelId) {
          if (!isWindowsUwpAppUserModelId(appUserModelId)) {
            throw new Error('Invalid packaged application ID');
          }
          await execFileAsync(POWERSHELL_PATH, [
            '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', WINDOWS_UWP_HOST_PATH, '-Action', 'Launch', '-AppId', appUserModelId,
          ], { windowsHide: true, timeout: 30000 });
          return;
        }
        const error = await shell.openPath(exec);
        if (error) console.error('[launch-native-app]', error);
        return;
      }
      let cmd = exec;

      // Если приложение требует терминал — оборачиваем в xterm
      if (terminal) {
        cmd = `xterm -e ${exec}`;
      }

      const child = spawn('sh', ['-c', cmd], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch (err) {
      console.error('[launch-native-app]', err.message);
    }
  });
}