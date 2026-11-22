import electronPkg from 'electron';
const { app, dialog, session } = electronPkg;
import {
  configureWindowsAutostart,
  configureWindowsTaskbar,
  ensureWindowsExplorerShell,
  restoreWindowsShellForAutostart,
} from './ipc_nativeWindows.js';

export default async function () {
  await app.whenReady();
  if (process.platform === 'win32') {
    try {
      await restoreWindowsShellForAutostart();
      await configureWindowsAutostart();
    } catch (error) {
      console.error('[windows-startup] shell/autostart configuration failed:', error.message);
      dialog.showErrorBox(
        'Настройка запуска Windows',
        `Не удалось восстановить Explorer или настроить автозапуск Omniscience.\n\n${error.message}`
      );
    }

    try {
      await ensureWindowsExplorerShell();
      await configureWindowsTaskbar();
      await ensureWindowsExplorerShell();
    } catch (error) {
      console.error('[windows-startup] Explorer taskbar configuration failed:', error.message);
      dialog.showErrorBox(
        'Не удалось настроить панель Windows',
        `Не удалось переместить панель задач Windows наверх и отключить её автоскрытие.\n\n${error.message}`
      );
    }
  }

  app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

  // Включаем Cross-Origin Isolation для всей сессии
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      },
    });
  });

  // arkh_protocol уже в global.$ — autoimport его подобрал.
  global.$.arkh_protocol.setupArkhProtocol();

  global.desktopCounter = 0;
  global.$.theme_app_setFromConfig();
  global.$.userAgent_change();

  await global.$.texts_load();
  await global.$.preloads_generate();
  await global.$.extensions_setup();
  await global.$.mainWindow_create();
  await global.$.ipc_setup();
  try {
    await global.mainWindowReady;
  } catch (error) {
    console.error('[startup] background window failed to become ready:', error.message);
    dialog.showErrorBox(
      'Не удалось запустить рабочий стол',
      `Панель не будет запущена, пока рабочий стол не готов.\n\n${error.message}`
    );
    throw error;
  }
  await global.$.TopBar_create();
}