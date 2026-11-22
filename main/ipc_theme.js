import { ipcMain, webContents } from 'electron';

let currentTheme = {
  enabled: true,
  colors: {
    maxR: 128, maxG: 0, maxB: 128,
    targetAlpha: 0.25, textBrightness: 255,
  },
};

const extensionSettingPaths = {
  enabled: 'themeEnabled',
  maxR: 'themeColors.maxR',
  maxG: 'themeColors.maxG',
  maxB: 'themeColors.maxB',
  targetAlpha: 'themeColors.targetAlpha',
  textBrightness: 'themeColors.textBrightness',
  blurShadow: 'themeColors.blurShadow',
  shadowColor: 'themeColors.shadowColor',
};

function isValidExtensionSetting(field, value) {
  if (field === 'enabled') return typeof value === 'boolean';
  if (field === 'shadowColor') return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  if (!Number.isFinite(value)) return false;
  if (['maxR', 'maxG', 'maxB', 'textBrightness'].includes(field)) {
    return value >= 0 && value <= 255;
  }
  if (field === 'targetAlpha') return value >= 0 && value <= 1;
  if (field === 'blurShadow') return value >= 0 && value <= 30;
  return false;
}

function broadcastTheme() {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) {
      wc.send('theme:update', currentTheme);
    }
  }
}

export default function () {
  // Отдать текущее состояние тому, кто только что загрузился
  ipcMain.handle('theme:get', () => currentTheme);

  ipcMain.on('theme:enabled-changed', (_e, enabled) => {
    currentTheme = { ...currentTheme, enabled: !!enabled };
    broadcastTheme();
  });

  ipcMain.on('theme:extension-update', (event, { field, value } = {}) => {
    const path = extensionSettingPaths[field];
    if (!path || !isValidExtensionSetting(field, value)) {
      console.warn('[theme] ignored invalid extension setting:', field);
      return;
    }

    if (field === 'enabled') {
      currentTheme = { ...currentTheme, enabled: value };
    } else {
      currentTheme = {
        ...currentTheme,
        colors: { ...currentTheme.colors, [field]: value },
      };
    }
    broadcastTheme();

    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send('shell:view-dispatch', {
        fromId: event.sender.id,
        type: 'updateSetting',
        payload: { path: `settings.${path}`, value },
      });
    }
  });

  // Принять новое состояние от главного окна и разослать ВСЕМ
  ipcMain.handle('theme:broadcast', (_e, payload) => {
    currentTheme = payload;
    broadcastTheme();
    return true;
  });
}