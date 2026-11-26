import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  stat,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function absoluteFilePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('An absolute file path is required');
  }
  return path.resolve(value);
}

export function absoluteDirectory(payload) {
  const requestedPath = payload?.path;
  if (typeof requestedPath !== 'string' || !path.isAbsolute(requestedPath)) {
    throw new Error('An absolute directory path is required');
  }
  return path.resolve(requestedPath);
}

export function safeEntryName(value) {
  if (typeof value !== 'string') throw new Error('A name is required');
  const name = value.trim();
  if (!name || name === '.' || name === '..'
    || path.basename(name) !== name
    || /[<>:"/\\|?*\u0000-\u001f]/.test(name)) {
    throw new Error('Invalid file or folder name');
  }
  return name;
}

export async function getEntry(filePath, name) {
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

export async function isDirectory(filePath) {
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

export function absoluteComponentappPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('An absolute file path is required');
  }
  return path.resolve(value);
}

export function isPathInside(candidate, directory) {
  const relativePath = path.relative(directory, candidate);
  return relativePath === ''
    || (relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath));
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

export async function validateExistingPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('At least one file path is required');
  }
  const resolvedPaths = paths.map(absoluteFilePath);
  for (const filePath of resolvedPaths) await lstat(filePath);
  return resolvedPaths;
}

export async function openFilePath(payload, context) {
  const filePath = absoluteFilePath(payload?.path);
  await lstat(filePath);
  const platform = typeof context === 'string' ? process.platform : context.platform ?? process.platform;
  if (platform === 'win32') {
    const nativeHost = getWindowsNativeHost(context);
    const result = await nativeHost.request('open-path', { path: filePath });
    if (result !== true) throw new Error(`Could not open ${filePath}`);
    return { opened: true };
  }

  const executable = platform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [filePath], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({ opened: true });
    });
  });
}

export async function openFileWith(payload, context) {
  const filePath = absoluteFilePath(payload?.path);
  await lstat(filePath);
  const platform = typeof context === 'string' ? process.platform : context.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new Error('Open With is only supported on Windows');
  }
  const spawnProcess = typeof context === 'string' ? spawn : context.spawnProcess ?? spawn;
  return new Promise((resolve, reject) => {
    const child = spawnProcess('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', filePath], {
      detached: true,
      stdio: 'ignore',
    });
    const onError = (error) => reject(error);
    child.once('error', onError);
    child.once('spawn', () => {
      child.removeListener('error', onError);
      child.unref();
      resolve({ opened: true });
    });
  });
}

export async function revealFilePath(payload, context) {
  const filePath = absoluteFilePath(payload?.path);
  const info = await stat(filePath);
  return openFilePath({ path: info.isDirectory() ? filePath : path.dirname(filePath) }, context);
}