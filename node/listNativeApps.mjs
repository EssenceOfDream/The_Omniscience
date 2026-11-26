import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import windowsUwpHostPath from './windowsUwpHostPath.mjs';
import { parseWindowsUwpApps } from '../main/windowsUwpApps.js';
import getWindowsIcons from './getWindowsIcons.mjs';
import collectStartMenuShortcuts from './collectStartMenuShortcuts.mjs';

const execFileAsync = promisify(execFile);

export default async function (context = {}) {
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
  const shortcutIcons = await getWindowsIcons(
    apps.filter((app) => app.launchType === 'shortcut').map((app) => ({
      id: app.id,
      path: app.launchTarget,
    })),
    context,
  );
  for (const app of apps) {
    if (app.launchType === 'shortcut') app.icon = shortcutIcons.get(app.id) || null;
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
  const uwpApps = parseWindowsUwpApps(stdout);
  const uwpIcons = await getWindowsIcons(uwpApps
    .filter((app) => app.iconPath)
    .map((app) => ({
      id: `uwp:${app.appUserModelId.toLowerCase()}`,
      path: app.iconPath,
    })), context);
  for (const app of uwpApps) {
    const id = `native:uwp:${app.appUserModelId.toLowerCase()}`;
    apps.push({
      id,
      name: app.title,
      launchType: 'uwp',
      launchTarget: app.appUserModelId,
      icon: uwpIcons.get(`uwp:${app.appUserModelId.toLowerCase()}`) || null,
    });
  }

  apps.sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  if (typeof context !== 'string') context.nativeApps = apps;
  return apps;
}