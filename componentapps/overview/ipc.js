import electronPkg from 'electron';
const { ipcMain, BrowserWindow } = electronPkg;
import {
  openOverview,
  closeOverview,
  toggleOverview,
  isOverviewOpen,
} from '../../main/ipc_overview.js';

export default function () {
  ipcMain.handle('overview:open', () => {
    openOverview();
    return { ok: true };
  });
  ipcMain.handle('overview:close', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event?.sender);
    if (senderWindow && !senderWindow.isDestroyed()
      && senderWindow !== global.mainWindow
      && senderWindow !== global.topbarWindow
      && senderWindow !== global.controlWindow
      && senderWindow !== global.overviewWindow) {
      senderWindow.close();
      return { ok: true };
    }
    closeOverview();
    return { ok: true };
  });
  ipcMain.handle('overview:toggle', () => {
    toggleOverview();
    return { ok: true };
  });
  ipcMain.handle('overview:is-open', () => isOverviewOpen());

  ipcMain.on('overview:open', () => {
    try { openOverview(); } catch (error) {
      console.error('[overview:open]', error.message);
    }
  });
  ipcMain.on('overview:close', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event?.sender);
    if (senderWindow && !senderWindow.isDestroyed()
      && senderWindow !== global.mainWindow
      && senderWindow !== global.topbarWindow
      && senderWindow !== global.controlWindow
      && senderWindow !== global.overviewWindow) {
      senderWindow.close();
      return;
    }
    try { closeOverview(); } catch (error) {
      console.error('[overview:close]', error.message);
    }
  });
  ipcMain.on('overview:toggle', () => {
    try { toggleOverview(); } catch (error) {
      console.error('[overview:toggle]', error.message);
    }
  });
}
