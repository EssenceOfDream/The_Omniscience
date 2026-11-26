import path from 'node:path';
import { rm } from 'node:fs/promises';
import { openEverything } from '../main/everythingSearch.js';
import DEFAULT_THEME_SETTINGS from './DEFAULT_THEME_SETTINGS.mjs';
import loadExtension from './loadExtension.mjs';
import listExtensions from './listExtensions.mjs';
import getExtensionRuntime from './getExtensionRuntime.mjs';
import readExtensionStorage from './readExtensionStorage.mjs';
import writeExtensionStorage from './writeExtensionStorage.mjs';
import getFileIcon from './getFileIcon.mjs';
import getFileIcons from './getFileIcons.mjs';
import getProgramIcon from './getProgramIcon.mjs';
import absoluteFilePath from './absoluteFilePath.mjs';
import absoluteDirectory from './absoluteDirectory.mjs';
import listDirectory from './listDirectory.mjs';
import getUserDirectories from './getUserDirectories.mjs';
import readDesktopDirectory from './readDesktopDirectory.mjs';
import createEntry from './createEntry.mjs';
import renameEntry from './renameEntry.mjs';
import openFilePath from './openFilePath.mjs';
import openFileWith from './openFileWith.mjs';
import revealFilePath from './revealFilePath.mjs';
import normalizeThemeSettings from './normalizeThemeSettings.mjs';
import openWindowsSettingsCategory from './openWindowsSettingsCategory.mjs';
import listPrograms from './listPrograms.mjs';
import getOverviewApps from './getOverviewApps.mjs';
import listNativeApps from './listNativeApps.mjs';
import launchNativeApp from './launchNativeApp.mjs';
import invokeComponentappIpc from './invokeComponentappIpc.mjs';
import listHiddenWindows from './listHiddenWindows.mjs';
import listNativeWindows from './listNativeWindows.mjs';
import manageHiddenWindow from './manageHiddenWindow.mjs';
import manageNativeWindow from './manageNativeWindow.mjs';
import prepareNativeWindowDrag from './prepareNativeWindowDrag.mjs';
import setCursorPosition from './setCursorPosition.mjs';
import getExplorerShellStatus from './getExplorerShellStatus.mjs';
import setShellWindowLayer from './setShellWindowLayer.mjs';
import setShellPanelDock from './setShellPanelDock.mjs';
import removeShellPanelDock from './removeShellPanelDock.mjs';
import setDesktopClipboard from './setDesktopClipboard.mjs';
import getDesktopClipboard from './getDesktopClipboard.mjs';
import pasteDesktopClipboard from './pasteDesktopClipboard.mjs';
import dropFilePaths from './dropFilePaths.mjs';
import writeDroppedFiles from './writeDroppedFiles.mjs';
import getWindowsNativeHost from './getWindowsNativeHost.mjs';
import { state } from './state.mjs';

export default async function (request, context) {
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
  if (request?.method === 'get-extensions-list') {
    return listExtensions(projectRoot);
  }
  if (request?.method === 'get-extension-runtime') {
    return getExtensionRuntime(projectRoot);
  }
  if (request?.method === 'extension-storage-get') {
    if (typeof context === 'string') throw new Error('Extension storage is unavailable');
    const values = await readExtensionStorage(context, request.payload?.extensionId);
    const keys = request.payload?.keys;
    if (keys == null) return values;
    if (typeof keys === 'string') return Object.hasOwn(values, keys) ? { [keys]: values[keys] } : {};
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.filter((key) => Object.hasOwn(values, key))
        .map((key) => [key, values[key]]));
    }
    if (typeof keys === 'object' && !Array.isArray(keys)) {
      return Object.fromEntries(Object.entries(keys)
        .map(([key, fallback]) => [key, Object.hasOwn(values, key) ? values[key] : fallback]));
    }
    throw new Error('Invalid extension storage keys');
  }
  if (request?.method === 'extension-storage-set') {
    if (typeof context === 'string') throw new Error('Extension storage is unavailable');
    return writeExtensionStorage(
      context,
      request.payload?.extensionId,
      request.payload?.items ?? {},
      request.payload?.removeKeys ?? [],
      request.payload?.clear === true,
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
    return apps.map(({ id, name, launchType, icon }) => ({
      id,
      name,
      title: name,
      category: 'native',
      entryPoint: null,
      launchable: true,
      launchType,
      icon,
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
    if (program.category === 'extensions' && request.payload?.params?.popup === true) {
      const extension = await loadExtension(projectRoot, program.name);
      if (!extension.popup) throw new Error(`Extension ${extension.name} has no action popup`);
      return {
        kind: 'extension_popup',
        name: extension.name,
        icon: extension.icon,
        appPath: path.posix.join(
          'omniscience',
          'extensions',
          extension.id,
          extension.popup,
        ),
        width: 360,
        height: 600,
      };
    }
    if (!program.launchable) throw new Error('This program is not migrated to Tauri yet');
    if (program.category === 'componentapps') {
      return {
        kind: 'componentapp',
        name: program.name,
        icon: await getProgramIcon(projectRoot, program.category, program.name),
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
      icon: await getProgramIcon(projectRoot, program.category, program.name),
    };
  }
  if (request?.method === 'list-directory') {
    return listDirectory(request.payload);
  }
  if (request?.method === 'get-file-icon') {
    return getFileIcon(request.payload, context);
  }
  if (request?.method === 'get-file-icons') {
    return getFileIcons(request.payload, context);
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
  if (request?.method === 'prepare-native-window-drag') {
    return prepareNativeWindowDrag(request.payload, context);
  }
  if (request?.method === 'set-cursor-position') {
    return setCursorPosition(request.payload, context);
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
  if (request?.method === 'open-path') {
    return openFilePath(request.payload, context);
  }
  if (request?.method === 'open-with') {
    return openFileWith(request.payload, context);
  }
  if (request?.method === 'drop-paths') {
    return dropFilePaths(request.payload);
  }
  if (request?.method === 'write-dropped-files') {
    return writeDroppedFiles(request.payload);
  }
  if (request?.method === 'reveal-path') {
    return revealFilePath(request.payload, context);
  }
  if (request?.method === 'copy-files' || request?.method === 'cut-files') {
    return setDesktopClipboard(
      request.payload,
      request.method === 'cut-files' ? 'cut' : 'copy',
      context,
    );
  }
  if (request?.method === 'paste-files') {
    return pasteDesktopClipboard(request.payload, context);
  }
  if (request?.method === 'get-cut-paths') {
    await getDesktopClipboard(context);
    return [...state.desktopCutPaths];
  }
  if (request?.method === 'clear-cut') {
    const clipboard = await getDesktopClipboard(context);
    const platform = typeof context === 'string' ? null : context.platform ?? process.platform;
    if (platform === 'win32' && clipboard.paths.length > 0) {
      const result = await getWindowsNativeHost(context).request('set-file-clipboard', {
        paths: clipboard.paths,
        isCut: false,
      });
      if (result !== true) throw new Error('Could not clear the Windows cut state');
    }
    state.desktopCutPaths = [];
    return { success: true };
  }
  if (request?.method === 'delete-path') {
    const filePath = absoluteFilePath(request.payload?.path);
    if (!path.basename(filePath)) throw new Error('Cannot delete a filesystem root');
    await rm(filePath, { recursive: true, force: false });
    return { success: true };
  }
  if (request?.method === 'parent-directory') {
    const directory = absoluteDirectory(request.payload);
    return path.dirname(directory);
  }
  throw new Error(`Unknown Node.js sidecar method: ${request?.method}`);
}