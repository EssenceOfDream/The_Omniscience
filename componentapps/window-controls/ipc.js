import electronPkg from 'electron';
const { ipcMain } = electronPkg;
import {
  prepareNativeWindowDrag,
  setNativeWindowBounds,
  closeWindowById,
  minimizeWindowById,
  maximizeWindowById,
} from '../../main/ipc_nativeWindows.js';

export default function () {
  ipcMain.handle('native-window:prepare-drag', async (_event, { id, mode, direction }) =>
    prepareNativeWindowDrag(id, mode, direction));

  ipcMain.on('native-window:set-bounds', async (_event, { id, bounds }) => {
    await setNativeWindowBounds(id, bounds);
  });

  ipcMain.on('native-window:drag-end', () => {});

  ipcMain.handle('native-window:close', (_event, { id }) => closeWindowById(id));
  ipcMain.handle('native-window:minimize', (_event, { id }) => minimizeWindowById(id));
  ipcMain.handle('native-window:maximize', (_event, { id, maximized }) =>
    maximizeWindowById(id, maximized));
}
