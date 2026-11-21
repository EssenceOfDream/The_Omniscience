import electronPkg from 'electron';
const { ipcMain, dialog } = electronPkg;
import {
  buildTopbarState,
  openWindowSettings,
  openSystemSettings,
  openPowerMenu,
  closePowerMenu,
} from '../../main/ipc_topbar.js';
import {
  focusWindowById,
  closeWindowById,
  minimizeWindowById,
  maximizeWindowById,
  recoverWindowsShell,
} from '../../main/ipc_nativeWindows.js';
import {
  openOverview,
  closeOverview,
  toggleOverview,
  isOverviewOpen,
} from '../../main/ipc_overview.js';
import { openEverything } from '../../main/everythingSearch.js';
import { getWindowById } from '../../main/ipc_windowManager.js';

export default function () {
  ipcMain.handle('topbar:get-state', () => buildTopbarState());

  ipcMain.on('shell-session:renderer-error', (event, payload) => {
    const allowed = event.sender === global.topbarWindow?.webContents
      || event.sender === global.controlWindow?.webContents;
    if (!allowed) return;
    const message = String(payload?.message || 'Topbar panel failed to render').slice(0, 2000);
    recoverWindowsShell(message).catch((error) => {
      console.error('[topbar-panel] renderer error:', error.message);
    });
  });

  ipcMain.on('topbar:toggle-overview', () => {
    try { toggleOverview(); } catch (error) {
      console.error('[topbar:toggle-overview]', error.message);
    }
  });
  ipcMain.on('topbar:open-overview', () => {
    try { openOverview(); } catch (error) {
      console.error('[topbar:open-overview]', error.message);
    }
  });
  ipcMain.on('topbar:close-overview', () => {
    try { closeOverview(); } catch (error) {
      console.error('[topbar:close-overview]', error.message);
    }
  });

  ipcMain.on('topbar:toggle-power-menu', () => {
    try {
      if (global.powerMenuWindow && !global.powerMenuWindow.isDestroyed()) closePowerMenu();
      else openPowerMenu();
    } catch (error) {
      console.error('[power-menu] failed to toggle menu:', error.message);
    }
  });

  ipcMain.on('topbar:focus-window', (_event, { id }) => {
    focusWindowById(id).catch((error) => console.error('[topbar:focus-window]', error.message));
  });
  ipcMain.on('topbar:close-window', (_event, payload = {}) => {
    const targetId = payload?.id ?? global.__focusedWindowId ?? null;
    if (targetId != null) closeWindowById(targetId).catch((error) => {
      console.error('[topbar:close-window]', error.message);
    });
  });
  ipcMain.on('topbar:minimize-window', (_event, payload = {}) => {
    const targetId = payload?.id ?? global.__focusedWindowId ?? null;
    if (targetId != null) minimizeWindowById(targetId).catch((error) => {
      console.error('[topbar:minimize-window]', error.message);
    });
  });
  ipcMain.on('topbar:maximize-window', (_event, payload = {}) => {
    const targetId = payload?.id ?? global.__focusedWindowId ?? null;
    if (targetId != null) maximizeWindowById(targetId, payload?.maximized).catch((error) => {
      console.error('[topbar:maximize-window]', error.message);
    });
  });

  ipcMain.on('topbar:open-window-settings', (_event, { id }) => {
    try { openWindowSettings(id); } catch (error) {
      console.error('[topbar:open-window-settings]', error.message);
    }
  });
  ipcMain.on('topbar:open-search', () => {
    if (process.platform !== 'win32') {
      try { toggleOverview(); } catch (error) {
        console.error('[topbar:open-search]', error.message);
      }
      return;
    }
    openEverything().catch((error) => {
      dialog.showErrorBox('Не удалось открыть Everything', error.message);
    });
  });
  ipcMain.on('topbar:open-settings', () => {
    try { openSystemSettings(); } catch (error) {
      dialog.showErrorBox('Не удалось открыть параметры', error.message);
    }
  });
  ipcMain.on('topbar:logout', () => openPowerMenu());

  ipcMain.handle('topbar:get-window-bounds', (_event, { id }) => {
    const win = getWindowById(id);
    return win ? win.getBounds() : null;
  });

  void isOverviewOpen();
}
