import electronPkg from 'electron';
const { app, ipcMain } = electronPkg;
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ── Статический импорт. Синхронный. До любого await.
// Именно поэтому arkh_protocol минует autoimport:
// ready может выстрелить раньше, чем autoimport отработает.
import { registerArkhScheme } from './main/arkh_protocol.js';

import autoimport from './main/autoimport.js';
import paths from './main/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isHostChild = process.env.OMNISCIENCE_HOST_CHILD === '1';

if (!isHostChild) {
  const hostScript = path.join(__dirname, 'main', 'processHost.cjs');
  const host = spawn(process.execPath, [hostScript], {
    cwd: __dirname,
    stdio: 'ignore',
    windowsHide: true,
    detached: true,
  });
  host.unref();
  app.whenReady().then(() => app.exit(0)).catch(() => app.exit(0));
} else {
// Регистрируем сразу. Тут нет await — управление не уходит,
// ready ещё не испущен.
registerArkhScheme();

(async () => {
  paths();
  await autoimport();

  global.$.log('Запуск приложения');
  global.$.config_load();

  await global.$.vite_build();

  global.$.app_on_close();
  global.$.app_on_beforeQuit();
  global.$.app_on_willQuit();

  await global.$.app_on_ready();
  global.$.processHostIPC();

  global.$.log('Приложение полностью запущено');
})();

ipcMain.on('get-project-root', (event) => {
  event.returnValue = app.getAppPath();
});
}