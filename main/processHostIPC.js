import electronPkg from 'electron';
const { BrowserWindow, ipcMain } = electronPkg;
import { broadcastTopbarState } from './ipc_topbar.js';
import {
  closeDevelopmentHostMenu,
  openDevelopmentHostMenu,
} from './developmentHostMenu.js';

const pendingHostActions = new Map();
let nextHostActionId = 0;

function assertDevelopmentHostMenuSender(event) {
  if (event.sender !== global.developmentHostMenuWindow?.webContents) {
    throw new Error('Development host menu request came from an unexpected window');
  }
}

function requestHostAction(action) {
  const requestId = `${process.pid}:${++nextHostActionId}`;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingHostActions.delete(requestId);
      resolve({ ok: false, error: 'Хост не ответил на запрос вовремя' });
    }, 5 * 60 * 1000);
    pendingHostActions.set(requestId, (result) => {
      clearTimeout(timeout);
      pendingHostActions.delete(requestId);
      resolve(result);
    });

    try {
      process.send({ type: 'host-action', requestId, action }, (error) => {
        if (error) {
          pendingHostActions.get(requestId)?.({ ok: false, error: error.message });
        }
      });
    } catch (error) {
      clearTimeout(timeout);
      pendingHostActions.delete(requestId);
      resolve({ ok: false, error: error.message });
    }
  });
}

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
      const menuWindow = global.developmentHostMenuWindow;
      if (menuWindow && !menuWindow.isDestroyed()) {
        menuWindow.webContents.send('development-host:status', message.status);
      }
    }
    if (message?.type === 'host-action-result') {
      pendingHostActions.get(message.requestId)?.(message.result);
    }
  });

  ipcMain.on('host:open-status', (event) => {
    if (event.sender !== global.topbarWindow?.webContents
      && event.sender !== global.controlWindow?.webContents) return;
    try {
      openDevelopmentHostMenu();
    } catch (error) {
      console.error('[development-host] failed to open menu:', error);
    }
  });

  ipcMain.on('development-host:close', (event) => {
    if (event.sender === global.developmentHostMenuWindow?.webContents) {
      closeDevelopmentHostMenu();
    }
  });

  ipcMain.handle('development-host:get-status', (event) => {
    assertDevelopmentHostMenuSender(event);
    return global.developmentStatus || null;
  });

  ipcMain.handle('development-host:action', (event, payload = {}) => {
    assertDevelopmentHostMenuSender(event);
    const action = payload?.action;
    if (!['apply', 'reload', 'restart', 'open-project', 'close'].includes(action)) {
      return { ok: false, error: 'Неизвестное действие хоста' };
    }
    return requestHostAction(action);
  });

  process.send({ type: 'omniscience-ready', pid: process.pid });
}
