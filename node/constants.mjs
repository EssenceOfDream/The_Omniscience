import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const categories = ['componentapps', 'webapps', 'extensions'];
export const DEFAULT_EXTENSION_TARGETS = Object.freeze({
  webapps: true,
  componentapps: true,
  extensions: false,
  shell: false,
  devtools: false,
});
export const defaultWindowsIconState = {
  cache: new Map(),
  pending: new Map(),
  queued: new Map(),
  flushScheduled: false,
};
export const windowsUwpHostPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../main/windowsUwpHost.ps1',
);
export const windowsAppIconHostPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../main/windowsAppIcons.ps1',
);
export const windowsSettingsCategories = Object.freeze({
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
});
export const DEFAULT_THEME_SETTINGS = Object.freeze({
  enabled: true,
  maxR: 128,
  maxG: 0,
  maxB: 128,
  targetAlpha: 0.25,
  textBrightness: 255,
  blurShadow: 8,
  shadowColor: '#ff00ff',
});
export const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
]);