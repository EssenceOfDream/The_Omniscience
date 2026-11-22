import electronPkg from 'electron';
const { BrowserWindow, ipcMain } = electronPkg;
import { broadcastTopbarState } from './ipc_topbar.js';

export default function () {
  if (typeof process.send !== 'function') return;

  const reloadRenderers = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.reloadIgnoringCache();
    }
  };

  process.on('message', (message) => {
    if (message?.type === 'reload-renderers') reloadRenderers();
    if (message?.type === 'host-status') {
      global.developmentStatus = message.status;
      broadcastTopbarState();
    }
  });

  ipcMain.handle('host:open-status', () => {
    if (typeof process.send === 'function') {
      process.send({ type: 'open-status' });
    }
    return true;
  });

  process.send({ type: 'omniscience-ready', pid: process.pid });
}
