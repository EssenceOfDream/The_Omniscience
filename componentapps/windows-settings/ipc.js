import electronPkg from 'electron';
const { ipcMain } = electronPkg;
import { spawn } from 'child_process';
import path from 'path';
import { pathToFileURL } from 'url';

const categories = {
  system: ['sysdm.cpl'],
  devices: ['printers'],
  network: ['ncpa.cpl'],
  personalization: ['/name', 'Microsoft.Personalization'],
  apps: ['appwiz.cpl'],
  accounts: ['/name', 'Microsoft.UserAccounts'],
  timeLanguage: ['intl.cpl'],
  gaming: ['joy.cpl'],
  accessibility: ['/name', 'Microsoft.EaseOfAccessCenter'],
  search: ['/name', 'Microsoft.IndexingOptions'],
  privacy: ['inetcpl.cpl'],
  update: ['/name', 'Microsoft.WindowsUpdate'],
};

function isSettingsAppFrame(event) {
  if (event.senderFrame !== event.sender.mainFrame) return false;

  try {
    const url = new URL(event.sender.getURL());
    url.search = '';
    url.hash = '';
    const expectedUrl = pathToFileURL(path.join(
      global.paths.distDir,
      'componentapps',
      'windows-settings',
      'index.html',
    )).href;
    return url.href === expectedUrl;
  } catch {
    return false;
  }
}

export default function () {
  ipcMain.handle('windows-settings:open-category', (event, category) => {
    if (!isSettingsAppFrame(event)) {
      return { ok: false, error: 'unauthorized' };
    }
    if (typeof category !== 'string'
      || !Object.prototype.hasOwnProperty.call(categories, category)) {
      return { ok: false, error: 'Раздел настроек не найден.' };
    }

    const controlPath = `${process.env.WINDIR || 'C:\\Windows'}\\System32\\control.exe`;
    return new Promise((resolve) => {
      const child = spawn(controlPath, categories[category], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.once('error', (error) => {
        console.error(`[windows-settings:${category}] failed to open system settings:`, error.message);
        resolve({ ok: false, error: error.message });
      });
      child.once('spawn', () => {
        child.unref();
        resolve({ ok: true });
      });
    });
  });
}
