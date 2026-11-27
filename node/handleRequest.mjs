import path from 'node:path';
import getExtensionRuntime from './getExtensionRuntime.mjs';
import listNativeApps from './listNativeApps.mjs';
import launchNativeApp from './launchNativeApp.mjs';
import invokeComponentappIpc from './invokeComponentappIpc.mjs';
import listHiddenWindows from './listHiddenWindows.mjs';
import listNativeWindows from './listNativeWindows.mjs';
import manageHiddenWindow from './manageHiddenWindow.mjs';
import manageNativeWindow from './manageNativeWindow.mjs';
import prepareNativeWindowDrag from './prepareNativeWindowDrag.mjs';
import getExplorerShellStatus from './getExplorerShellStatus.mjs';
import setShellWindowLayer from './setShellWindowLayer.mjs';
import setShellPanelDock from './setShellPanelDock.mjs';
import removeShellPanelDock from './removeShellPanelDock.mjs';
import setDesktopClipboard from './setDesktopClipboard.mjs';
import getDesktopClipboard from './getDesktopClipboard.mjs';
import pasteDesktopClipboard from './pasteDesktopClipboard.mjs';
import getWindowsNativeHost from './getWindowsNativeHost.mjs';
import getWindowsIcons from './getWindowsIcons.mjs';
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
  if (request?.method === 'get-extension-runtime') {
    return getExtensionRuntime(projectRoot);
  }
  if (request?.method === 'componentapp-ipc') {
    return invokeComponentappIpc(request.payload, context);
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
  if (request?.method === 'get-windows-file-icons') {
    const requests = request.payload?.requests;
    if (!Array.isArray(requests)
      || requests.some((entry) => !entry
        || typeof entry.id !== 'string'
        || typeof entry.path !== 'string'
        || entry.id !== entry.path
        || !path.isAbsolute(entry.path))) {
      throw new Error('Windows icon requests must contain absolute paths');
    }
    return Object.fromEntries(await getWindowsIcons(requests, context));
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
  if (request?.method === 'prepare-program-window-drag') {
    const { hwnd, mode, direction } = request.payload ?? {};
    if (typeof hwnd !== 'string' || !/^[1-9]\d*$/.test(hwnd)) {
      throw new Error('A valid program-window handle is required');
    }
    if (mode !== 'move' && mode !== 'resize') {
      throw new Error('Unsupported program-window drag mode');
    }
    const resizeDirections = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
    if (mode === 'resize' && !resizeDirections.includes(direction)) {
      throw new Error('Unsupported program-window resize direction');
    }

    const result = await getWindowsNativeHost(context).request('prepare-drag', {
      hwnd,
      mode,
      direction: direction ?? '',
    });
    if (!result) return { ok: false, abort: true };
    return {
      ok: true,
      bounds: {
        x: result.x,
        y: result.y,
        width: result.width,
        height: result.height,
      },
      cursor: { x: result.cursorX, y: result.cursorY },
      nativeDrag: Boolean(result.nativeDrag),
    };
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
  throw new Error(`Unknown Node.js sidecar method: ${request?.method}`);
}