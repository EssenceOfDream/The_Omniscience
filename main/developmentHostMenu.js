import electronPkg from 'electron';
const { BrowserWindow, screen } = electronPkg;
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  registerShellWindow,
  unregisterShellWindow,
} from './ipc_windowManager.js';
import { enableWindowsBackdropBlur } from './ipc_nativeWindows.js';
import { installWindowsBackdropBlur } from './windowsBackdrop.js';

let developmentHostMenuWindow = null;

export function openDevelopmentHostMenu() {
  if (developmentHostMenuWindow && !developmentHostMenuWindow.isDestroyed()) {
    developmentHostMenuWindow.focus();
    developmentHostMenuWindow.webContents.send(
      'development-host:status',
      global.developmentStatus || null,
    );
    return developmentHostMenuWindow;
  }

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const bounds = display.bounds;
  const topbarBounds = global.topbarWindow && !global.topbarWindow.isDestroyed()
    ? global.topbarWindow.getBounds()
    : null;
  const top = process.platform === 'win32'
    ? (topbarBounds?.y ?? bounds.y) + (topbarBounds?.height ?? 28)
    : topbarBounds
      ? topbarBounds.y + topbarBounds.height
      : bounds.y + 72;
  const overlayY = Math.max(bounds.y, Math.min(top, bounds.y + bounds.height - 1));
  const overlayBounds = {
    x: bounds.x,
    y: overlayY,
    width: bounds.width,
    height: bounds.y + bounds.height - overlayY,
  };
  const menuUrl = pathToFileURL(path.join(
    global.paths.distDir,
    'componentapps',
    'development-host',
    'index.html',
  ));

  const win = new BrowserWindow({
    ...overlayBounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    type: 'toolbar',
    webPreferences: {
      preload: path.join(global.paths.componentappsDir, 'power-menu', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      transparent: true,
      backgroundColor: '#00000000',
    },
  });
  installWindowsBackdropBlur(win, { apply: enableWindowsBackdropBlur });

  developmentHostMenuWindow = win;
  global.developmentHostMenuWindow = win;
  try {
    win.setAlwaysOnTop(true, 'screen-saver');
  } catch (error) {
    console.warn('[development-host] failed to set overlay z-order:', error.message);
  }

  const registryId = `__development_host_menu__:${win.id}`;
  try {
    registerShellWindow(win, registryId, { title: 'Omniscience Development Host' });
  } catch (error) {
    console.error('[development-host] failed to register menu window:', error.message);
  }

  win.loadURL(menuUrl.href).catch((error) => {
    console.error('[development-host] failed to load menu:', error.message);
    if (!win.isDestroyed()) win.close();
  });
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
    win.webContents.send('development-host:status', global.developmentStatus || null);
  });
  win.on('closed', () => {
    try {
      unregisterShellWindow(registryId);
    } catch (error) {
      console.error('[development-host] failed to unregister menu window:', error.message);
    }
    if (developmentHostMenuWindow === win) developmentHostMenuWindow = null;
    if (global.developmentHostMenuWindow === win) global.developmentHostMenuWindow = null;
  });

  return win;
}

export function closeDevelopmentHostMenu() {
  if (!developmentHostMenuWindow || developmentHostMenuWindow.isDestroyed()) {
    developmentHostMenuWindow = null;
    global.developmentHostMenuWindow = null;
    return;
  }
  developmentHostMenuWindow.close();
}
