import electronPkg from 'electron';
const { BrowserWindow, ipcMain, screen } = electronPkg;
import { attachToWebContents } from './ipc_browserContextMenu.js';
import {
  getWindowById,
  registerShellWindow,
  unregisterShellWindow,
} from './ipc_windowManager.js';
import { destroyViewsForParentWindowInstance } from './ipc_viewManager.js';
import { getOverviewBounds } from './overviewBounds.js';

let overviewWindow = null;

export function isOverviewOpen() {
  return !!(overviewWindow && !overviewWindow.isDestroyed());
}

/* ------------------------------------------------------------------ */
/* Вычисление точных границ Overview                                   */
/* ------------------------------------------------------------------ */

function computeOverviewBounds() {
  const display = screen.getPrimaryDisplay();
  const topbar = global.topbarWindow;
  const topbarBounds = topbar && !topbar.isDestroyed()
    ? topbar.getBounds()
    : { y: display.bounds.y, height: 0 };
  return getOverviewBounds(display.bounds, topbarBounds);
}

export function openOverview() {
  if (isOverviewOpen()) {
    try { overviewWindow.focus(); } catch { /* ignore */ }
    return overviewWindow;
  }

  const bounds = computeOverviewBounds();

  const win = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height,
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
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      webviewTag: false,
      transparent: true,
      backgroundColor: '#00000000',
    },
  });

  const windowRegistryId = `__overview__:${win.id}`;
  const overviewUrl = new URL(global.paths.overviewIndex);
  overviewUrl.searchParams.set('overviewInstance', windowRegistryId);
  try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (error) {
    console.error('[overview] failed to set overlay order:', error.message);
  }
  try { win.setFullScreenable(false); } catch (error) {
    console.error('[overview] failed to disable fullscreen:', error.message);
  }
  try { attachToWebContents(win.webContents); } catch (error) {
    console.error('[overview] failed to attach context menu:', error.message);
  }
  if (!registerShellWindow(win, windowRegistryId, { title: 'Overview' })) {
    console.error('[overview] failed to register window');
  }
  win.loadURL(overviewUrl.href).catch((error) => {
    console.error('[overview] failed to load window:', error.message);
    if (!win.isDestroyed()) win.close();
  });

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    // Пересчитываем ещё раз — вдруг TopBar уже подвинулся
    win.setBounds(computeOverviewBounds());
    win.show();
    try { win.focus(); } catch { /* ignore */ }
    global.topbarBroadcast?.();
  });

  win.on('closed', () => {
    destroyViewsForParentWindowInstance(win);
    if (getWindowById(windowRegistryId) === win) unregisterShellWindow(windowRegistryId);
    if (overviewWindow === win) overviewWindow = null;
    global.topbarBroadcast?.();
  });

  win.on('resize', () => {
    if (win.isDestroyed()) return;
    const bounds = computeOverviewBounds();
    const currentBounds = win.getBounds();
    if (currentBounds.x !== bounds.x || currentBounds.y !== bounds.y
      || currentBounds.width !== bounds.width || currentBounds.height !== bounds.height) {
      win.setBounds(bounds);
    }
  });

  overviewWindow = win;
  return win;
}

export function closeOverview() {
  if (!isOverviewOpen()) return;
  destroyViewsForParentWindowInstance(overviewWindow);
  overviewWindow.close();
  overviewWindow = null;
}

export function toggleOverview() {
  if (isOverviewOpen()) closeOverview();
  else openOverview();
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

export default function () {
  ipcMain.handle('overview:open',    () => { openOverview();   return { ok: true }; });
  ipcMain.handle('overview:close',   () => { closeOverview();  return { ok: true }; });
  ipcMain.handle('overview:toggle',  () => { toggleOverview(); return { ok: true }; });
  ipcMain.handle('overview:is-open', () => isOverviewOpen());

  ipcMain.on('overview:open',   () => { try { openOverview();   } catch (e) { console.error('[overview:open]', e?.message); } });
  ipcMain.on('overview:close',  () => { try { closeOverview();  } catch (e) { console.error('[overview:close]', e?.message); } });
  ipcMain.on('overview:toggle', () => { try { toggleOverview(); } catch (e) { console.error('[overview:toggle]', e?.message); } });
}