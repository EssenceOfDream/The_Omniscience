import electronPkg from 'electron';
const { ipcMain, BrowserWindow, screen, dialog } = electronPkg;
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { pathToFileURL } from 'url';
import os from 'os';
import {
  listWindows,
  getWindowById,
  createWindowByRequest,
  listDevTools,
  registerOwnWindow,
  unregisterOwnWindow,
  registerShellWindow,
  unregisterShellWindow,
} from './ipc_windowManager.js';
import {
  getNativeState,
  focusWindowById,
  closeWindowById,
  minimizeWindowById,
  maximizeWindowById,
  setWindowZOrderById,
  recoverWindowsShell,
  suspendWindows,
} from './ipc_nativeWindows.js';
import {
  openOverview, closeOverview, toggleOverview, isOverviewOpen,
} from './ipc_overview.js';

let cachedApps = [];
let windowSettingsWin = null;
let powerMenuWindow = null;
const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/* Topbar geometry                                                     */
/* ------------------------------------------------------------------ */

const TOPBAR_HEIGHT = process.platform === 'win32' ? 28 : 72;

function enforceTopbarGeometry() {
  const w = global.topbarWindow;
  if (!w || w.isDestroyed()) return;
  try {
    w.setMinimumSize(1, TOPBAR_HEIGHT);
    w.setMaximumSize(9999, TOPBAR_HEIGHT);
    const b = w.getBounds();
    if (b.height !== TOPBAR_HEIGHT) {
      w.setBounds({ x: b.x, y: b.y, width: b.width, height: TOPBAR_HEIGHT });
    }
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

export async function initTopbarState() {
  try {
    const mod = await import('./ipc_getAppsList.js');
    if (typeof mod.buildAppsList === 'function') {
      cachedApps = await mod.buildAppsList();
    }
  } catch (err) {
    console.error('[topbar] buildAppsList failed:', err.message);
  }
  enforceTopbarGeometry();
  broadcastTopbarState();
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

// На Windows "id" native-окна — это HWND (строка). Нормализуем к строке
// в нижнем регистре — этого достаточно для сравнения с activeXid.
function normalizeNativeId(x) {
  return x ? String(x).toLowerCase() : null;
}

/* ------------------------------------------------------------------ */
/* Build state                                                         */
/* ------------------------------------------------------------------ */

function buildState() {
  const cfg = global.config?.topbar || {};
  const { windows: nativeWindows, activeXid } = getNativeState();
  const activeNorm = normalizeNativeId(activeXid);

  /* --- Electron BrowserWindow'ы --- */
  const ourWindows = listWindows().map((w) => {
    const b = w.bounds || {};
    const xid = normalizeNativeId(w.xid);
    return {
      id: w.id,
      xid,
      kind: 'our',
      title: w.title || '',
      icon: w.icon || null,
      maximized: !!w.maximized,
      minimized: !!w.minimized,
      isHidden: false,
      focused: !!w.focused || !!(activeNorm && xid && xid === activeNorm),
      wmClass: null,
      x: b.x, y: b.y, width: b.width, height: b.height,
      isBridgeOverlay: false,
      daemonWindowId: null,
      gtkXid: null,
      isDevTools: false,
      ownerId: null,
      pid: null,
      parentXid: null,
      overlayWindowId: null,
    };
  });

  /* --- DevTools webContents --- */
  const devToolsWindows = [];
  try {
    for (const d of listDevTools()) {
      devToolsWindows.push({
        id: d.id, xid: null, kind: 'devtools',
        title: 'DevTools', icon: null,
        maximized: false, minimized: false,
        isHidden: false,
        focused: !!d.focused, wmClass: null,
        x: d.bounds?.x ?? 0, y: d.bounds?.y ?? 0,
        width: d.bounds?.width ?? 0, height: d.bounds?.height ?? 0,
        isBridgeOverlay: false, daemonWindowId: null, gtkXid: null,
        isDevTools: true, ownerId: d.ownerId || null,
        pid: null, parentXid: null,
        overlayWindowId: null,
      });
    }
  } catch (e) {
    console.warn('[topbar] listDevTools failed:', e.message);
  }

  /* --- Native Windows-окна ---
   * PS1-хост уже фильтрует наши собственные окна по PID (ownPid),
   * но оставим дополнительную защиту по id на всякий случай. */
  const ourIds = new Set(ourWindows.map((w) => w.xid).filter(Boolean));

  const native = nativeWindows
    .filter((w) => !ourIds.has(normalizeNativeId(w.id)))
    .map((w) => {
      const pidNum = Number(w.pid) || null;
      const normId = normalizeNativeId(w.id);

      return {
        id: w.id, xid: normId, kind: 'native',
        title: w.title || w.wmClass || 'Окно',
        icon: w.icon || null,
        maximized: !!w.isMaximized,
        minimized: !!w.isMinimized,
        isHidden: false,
        focused: !!(activeNorm && normId === activeNorm),
        wmClass: w.wmClass,
        x: w.x, y: w.y, width: w.width, height: w.height,
        isBridgeOverlay: false, daemonWindowId: null, gtkXid: null,
        isDevTools: false, ownerId: null,
        pid: pidNum, parentXid: null,
        overlayWindowId: null,
      };
    });

  const windows = [...ourWindows, ...devToolsWindows, ...native];

  const fallbackWindowId = global.__focusedWindowId
    || windows.find((w) => w.focused)?.id
    || windows[0]?.id
    || null;
  const activeWindow = windows.find((w) => w.id === fallbackWindowId) || windows[0] || null;

  return {
    windows, activeWindow, apps: cachedApps,
    isWindowsPanel: process.platform === 'win32',
    overviewTabs: cfg.overviewTabs || [
      { id: 'apps-list', visible: true },
      { id: 'settings', visible: true },
    ],
    showWindowList: process.platform !== 'win32' && (cfg.showWindowList ?? true),
    showClock: cfg.showClock ?? true,
    showClockMs: cfg.showClockMs ?? false,
    overviewOpen: isOverviewOpen(),
  };
}

export function broadcastTopbarState() {
  try {
    const state = buildState();
    for (const w of [global.topbarWindow, global.controlWindow]) {
      if (w && !w.isDestroyed()) w.webContents.send('topbar:state-update', state);
    }
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Window settings                                                     */
/* ------------------------------------------------------------------ */

function settingsUrlFor(windowId) {
  const base = `file://${global.paths.distDir}/componentapps/window-settings/index.html`;
  const q = new URLSearchParams({ windowId });
  return `${base}?${q.toString()}`;
}

function openWindowSettings(windowId) {
  if (!windowId) return;

  if (windowSettingsWin && !windowSettingsWin.isDestroyed()) {
    windowSettingsWin.loadURL(settingsUrlFor(windowId));
    windowSettingsWin.focus();
    return;
  }

  const display = screen.getPrimaryDisplay();
  const wa = display.workAreaSize;
  const W = 320, H = 560;

  const win = new BrowserWindow({
    width: W, height: H,
    x: Math.max(0, wa.width - W - 20),
    y: 90,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    type: 'toolbar',
    show: false,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      transparent: true,
      backgroundColor: '#00000000',
    },
  });

  try { win.setAlwaysOnTop(true, 'screen-saver'); } catch { /* ignore */ }

  win.loadURL(settingsUrlFor(windowId));

  try {
    registerOwnWindow(win, '__window_settings__', {
      appId: 'window-settings',
      title: 'Window Settings',
      icon: null,
    });
  } catch { /* ignore */ }

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  });

  win.on('closed', () => {
    try { unregisterOwnWindow('__window_settings__'); } catch { /* ignore */ }
    windowSettingsWin = null;
  });

  windowSettingsWin = win;
}

function closePowerMenu() {
  if (!powerMenuWindow || powerMenuWindow.isDestroyed()) {
    powerMenuWindow = null;
    return;
  }
  powerMenuWindow.close();
}

function openSystemSettings() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1080, workArea.width);
  const height = Math.min(720, workArea.height);

  return createWindowByRequest({
    id: '__system_settings__',
    appId: 'windows-settings',
    url: pathToFileURL(path.join(
      global.paths.distDir,
      'componentapps',
      'windows-settings',
      'index.html',
    )).href,
    preload: path.join(
      global.paths.componentappsDir,
      'windows-settings',
      'preload.js',
    ),
    title: 'Параметры',
    icon: null,
    bounds: {
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      width,
      height,
    },
  });
}

function openPowerMenu() {
  if (powerMenuWindow && !powerMenuWindow.isDestroyed()) {
    powerMenuWindow.focus();
    return;
  }

  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;
  const topbarBounds = global.topbarWindow && !global.topbarWindow.isDestroyed()
    ? global.topbarWindow.getBounds()
    : { y: y + TOPBAR_HEIGHT, height: 0 };
  const top = process.platform === 'win32'
    ? topbarBounds.y + topbarBounds.height
    : y + TOPBAR_HEIGHT;
  const menuHeight = Math.max(1, y + height - top);
  const win = new BrowserWindow({
    x,
    y: top,
    width,
    height: menuHeight,
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
      preload: global.paths.reactPreload,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      transparent: true,
      backgroundColor: '#00000000',
    },
  });

  powerMenuWindow = win;
  try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (error) {
    console.warn('[power-menu] failed to set overlay z-order:', error.message);
  }
  win.loadURL(global.paths.powerMenuIndex).catch((error) => {
    console.error('[power-menu] failed to load menu:', error.message);
    closePowerMenu();
  });
  try {
    registerShellWindow(win, '__power_menu__', { title: 'Power Menu' });
  } catch (error) {
    console.error('[power-menu] failed to register overlay window:', error.message);
  }
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  });
  win.on('closed', () => {
    try { unregisterShellWindow('__power_menu__'); } catch (error) {
      console.error('[power-menu] failed to unregister overlay window:', error.message);
    }
    if (powerMenuWindow === win) powerMenuWindow = null;
  });
}

async function performPowerAction(action) {
  if (process.platform === 'win32') {
    if (action === 'sleep') return suspendWindows();
    const args = {
      logout: ['/l'],
      shutdown: ['/s', '/t', '0'],
      restart: ['/r', '/t', '0'],
    }[action];
    if (!args) throw new Error(`Unsupported power action: ${action}`);
    const executable = `${process.env.WINDIR || 'C:\\Windows'}\\System32\\shutdown.exe`;
    await execFileAsync(executable, args, { windowsHide: true, timeout: 10000 });
    return true;
  }

  if (process.platform === 'linux') {
    if (action === 'sleep') {
      await execFileAsync('systemctl', ['suspend'], { timeout: 15000 });
    } else if (action === 'shutdown' || action === 'restart') {
      await execFileAsync('systemctl', [action === 'shutdown' ? 'poweroff' : 'reboot'], {
        timeout: 15000,
      });
    } else if (action === 'logout') {
      const sessionId = process.env.XDG_SESSION_ID;
      if (sessionId) {
        await execFileAsync('loginctl', ['terminate-session', sessionId], { timeout: 15000 });
      } else {
        await execFileAsync('loginctl', ['terminate-user', os.userInfo().username], { timeout: 15000 });
      }
    } else {
      throw new Error(`Unsupported power action: ${action}`);
    }
    return true;
  }

  throw new Error(`Power actions are not supported on ${process.platform}`);
}

function schedulePowerAction(action) {
  setTimeout(() => {
    performPowerAction(action).catch((error) => {
      console.error(`[power-menu] ${action} failed:`, error.message);
      dialog.showErrorBox(
        'Не удалось выполнить действие питания',
        `${action}: ${error.message}`,
      );
    });
  }, 250);
}

/* ------------------------------------------------------------------ */
/* getWindowData — для окна настроек                                   */
/* ------------------------------------------------------------------ */

function getWindowData(id) {
  if (!id) return null;

  const ourList = listWindows();
  const ourWin = ourList.find((x) => x.id === id);
  if (ourWin) {
    const b = ourWin.bounds || {};
    return {
      id: ourWin.id, kind: 'our',
      title: ourWin.title, icon: ourWin.icon,
      xid: normalizeNativeId(ourWin.xid), pid: null, wmClass: null,
      maximized: !!ourWin.maximized, minimized: !!ourWin.minimized,
      x: b.x, y: b.y, width: b.width, height: b.height,
      isBridgeOverlay: false,
      daemonWindowId: null,
      gtkXid: null,
      ownerId: null,
      opacity: 1.0,
      overlayWindowId: null,
    };
  }

  if (String(id).startsWith('__devtools__:')) {
    const d = listDevTools().find((x) => x.id === id);
    if (d) {
      return {
        id: d.id, kind: 'devtools', title: 'DevTools', icon: null,
        xid: null, pid: null, wmClass: null,
        maximized: false, minimized: false,
        x: d.bounds?.x ?? 0, y: d.bounds?.y ?? 0,
        width: d.bounds?.width ?? 0, height: d.bounds?.height ?? 0,
        isBridgeOverlay: false, daemonWindowId: null, gtkXid: null,
        ownerId: d.ownerId || null, opacity: 1.0,
        overlayWindowId: null,
      };
    }
  }

  const { windows: nativeList } = getNativeState();
  const norm = normalizeNativeId(id);
  const native = nativeList.find((x) => normalizeNativeId(x.id) === norm);
  if (native) {
    return {
      id: native.id, kind: 'native',
      title: native.title || native.wmClass || 'Окно',
      icon: native.icon, xid: normalizeNativeId(native.id),
      pid: native.pid, wmClass: native.wmClass,
      maximized: !!native.isMaximized, minimized: !!native.isMinimized,
      x: native.x, y: native.y, width: native.width, height: native.height,
      isBridgeOverlay: false, daemonWindowId: null, gtkXid: null,
      ownerId: null, opacity: 1.0,
      overlayWindowId: null,
    };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export default function () {
  global.topbarBroadcast = broadcastTopbarState;

  ipcMain.handle('topbar:get-state', () => buildState());

  ipcMain.on('shell-session:renderer-error', (event, payload) => {
    if (event.sender !== global.topbarWindow?.webContents
      && event.sender !== global.controlWindow?.webContents) return;
    const message = String(payload?.message || 'TopBar renderer failed to render').slice(0, 2000);
    recoverWindowsShell(message).catch((error) => {
      console.error('[shell-session:renderer-error]', error.message);
    });
  });

  /* --- Overview --- */
  ipcMain.on('topbar:toggle-overview', () => {
    try { toggleOverview(); } catch (e) { console.error('[topbar:toggle-overview]', e?.message || e); }
  });
  ipcMain.on('topbar:open-overview', () => {
    try { openOverview(); } catch (e) { console.error('[topbar:open-overview]', e?.message || e); }
  });
  ipcMain.on('topbar:close-overview', () => {
    try { closeOverview(); } catch (e) { console.error('[topbar:close-overview]', e?.message || e); }
  });
  ipcMain.on('topbar:toggle-power-menu', (event) => {
    if (event.sender !== global.topbarWindow?.webContents) return;
    try {
      if (powerMenuWindow && !powerMenuWindow.isDestroyed()) closePowerMenu();
      else openPowerMenu();
    } catch (error) {
      console.error('[power-menu] failed to toggle menu:', error.message);
    }
  });
  ipcMain.on('power-menu:close', (event) => {
    if (event.sender !== powerMenuWindow?.webContents) return;
    closePowerMenu();
  });
  ipcMain.handle('power-menu:execute', (event, { action } = {}) => {
    if (event.sender !== powerMenuWindow?.webContents) {
      return { ok: false, error: 'unauthorized' };
    }
    if (!['logout', 'shutdown', 'restart', 'sleep'].includes(action)) {
      return { ok: false, error: 'invalid_power_action' };
    }
    closePowerMenu();
    schedulePowerAction(action);
    return { ok: true };
  });

  /* --- Управление окнами --- */
  ipcMain.on('topbar:focus-window', (_e, { id }) => {
    focusWindowById(id).catch((e) => console.error('[topbar:focus-window]', e?.message || e));
  });
  ipcMain.on('topbar:close-window', (_e, payload = {}) => {
    const { id } = payload || {};
    const targetId = id ?? global.__focusedWindowId ?? null;
    if (targetId == null) return;
    closeWindowById(targetId).catch((e) => console.error('[topbar:close-window]', e?.message || e));
  });
  ipcMain.on('topbar:minimize-window', (_e, payload = {}) => {
    const { id } = payload || {};
    const targetId = id ?? global.__focusedWindowId ?? null;
    if (targetId == null) return;
    minimizeWindowById(targetId).catch((e) => console.error('[topbar:minimize-window]', e?.message || e));
  });
  ipcMain.on('topbar:maximize-window', (_e, payload = {}) => {
    const { id, maximized } = payload || {};
    const targetId = id ?? global.__focusedWindowId ?? null;
    if (targetId == null) return;
    maximizeWindowById(targetId, maximized).catch((e) => console.error('[topbar:maximize-window]', e?.message || e));
  });

  ipcMain.on('topbar:open-devtools', (_e, { id }) => {
    if (!id) return;
    const win = getWindowById(id);
    if (!win) return;
    win.webContents.openDevTools({ mode: 'detach' });
  });

  /* --- Window settings --- */
  ipcMain.on('topbar:open-window-settings', (_e, { id }) => {
    try { openWindowSettings(id); }
    catch (e) { console.error('[topbar:open-window-settings]', e?.message || e); }
  });

  ipcMain.handle('window-settings:get', (_e, { id }) => getWindowData(id));

  ipcMain.handle('window-settings:set-z-order', (_e, { id, layer }) =>
    setWindowZOrderById(id, layer));

  ipcMain.on('window-settings:set-opacity', async (_e, { id, opacity }) => {
    if (!id || typeof opacity !== 'number') return;
    try {
      const { setWindowOpacityById } = await import('./ipc_nativeWindows.js');
      await setWindowOpacityById(id, opacity);
    } catch (e) {
      console.error('[window-settings:set-opacity]', e?.message || e);
    }
  });

  /* --- Bridge overlay (unsupported on Windows) --- */
  ipcMain.on('topbar:open-overlay', () => {
    console.warn('[overlay] GTK overlay is not supported on Windows');
  });

  /* --- Прочее --- */
  ipcMain.on('topbar:launch-app', (_e, { app: appRef }) => {
    console.log('[topbar] launch', appRef);
  });

  ipcMain.on('topbar:open-search', () => {
    try { toggleOverview(); }
    catch (err) { console.error('[topbar:open-search]', err.message); }
  });

  ipcMain.on('topbar:open-settings', (event) => {
    if (event.sender !== global.topbarWindow?.webContents) return;
    try {
      openSystemSettings();
    } catch (error) {
      console.error('[topbar:open-settings] failed to open settings window:', error.message);
      dialog.showErrorBox('Не удалось открыть параметры', error.message);
    }
  });
  ipcMain.on('topbar:logout', () => {
    openPowerMenu();
  });

  ipcMain.handle('topbar:get-window-bounds', (_e, { id }) => {
    const win = getWindowById(id);
    return win ? win.getBounds() : null;
  });

  setTimeout(() => { initTopbarState(); }, 0);

  /* ─────────────────────────────────────────────────────────────
   * Автотрансляция состояния при загрузке TopBar'а
   * ───────────────────────────────────────────────────────────── */
  function attachTopbarAutoBroadcast() {
    const windows = [global.topbarWindow, global.controlWindow]
      .filter((w) => w && !w.isDestroyed());
    if (windows.length === 0) {
      setTimeout(attachTopbarAutoBroadcast, 100);
      return;
    }
    for (const w of windows) w.webContents.on('did-finish-load', () => {
      broadcastTopbarState();
    });
    if (windows.some((w) => !w.webContents.isLoading())) {
      broadcastTopbarState();
    }
  }
  setTimeout(attachTopbarAutoBroadcast, 100);
}