import electronPkg from 'electron';
const { ipcMain, BrowserWindow } = electronPkg;
import {
  closePowerMenu,
  schedulePowerAction,
} from '../../main/ipc_topbar.js';

export default function () {
  ipcMain.on('power-menu:close', (event) => {
    if (event.sender === global.powerMenuWindow?.webContents) {
      closePowerMenu();
      return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.handle('power-menu:execute', (event, { action } = {}) => {
    if (!['logout', 'shutdown', 'restart', 'sleep'].includes(action)) {
      return { ok: false, error: 'invalid_power_action' };
    }

    if (event.sender === global.powerMenuWindow?.webContents) {
      closePowerMenu();
    } else {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) win.close();
    }

    schedulePowerAction(action);
    return { ok: true };
  });
}
