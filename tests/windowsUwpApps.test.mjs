import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWindowsUwpAppUserModelId,
  parseWindowsUwpApps,
} from '../main/windowsUwpApps.js';

test('recognizes packaged application IDs without accepting desktop app IDs', () => {
  assert.equal(isWindowsUwpAppUserModelId('Microsoft.WindowsStore_8wekyb3d8bbwe!App'), true);
  assert.equal(isWindowsUwpAppUserModelId('windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel'), true);
  assert.equal(isWindowsUwpAppUserModelId('Chrome'), false);
  assert.equal(isWindowsUwpAppUserModelId('C:\\Apps\\app.exe'), false);
});

test('parses Start apps output and removes invalid or duplicate IDs', () => {
  assert.deepEqual(
    parseWindowsUwpApps(JSON.stringify([
      { Name: ' Store ', AppID: 'Microsoft.WindowsStore_8wekyb3d8bbwe!App' },
      { Name: 'Duplicate', AppID: 'microsoft.windowsstore_8wekyb3d8bbwe!app' },
      { Name: 'Desktop app', AppID: 'Chrome' },
      { Name: 'Параметры', AppID: 'Example.Settings_1234567890123!Main' },
      { AppID: 'Example.Package_1234567890123!Main' },
    ])),
    [
      { title: 'Store', appUserModelId: 'Microsoft.WindowsStore_8wekyb3d8bbwe!App' },
      { title: 'Параметры', appUserModelId: 'Example.Settings_1234567890123!Main' },
      { title: 'Example.Package_1234567890123!Main', appUserModelId: 'Example.Package_1234567890123!Main' },
    ],
  );
});
