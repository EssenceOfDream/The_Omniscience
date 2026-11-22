import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getWindowsShortcutIconCandidates,
  getWindowsShortcutIconSources,
  parseWindowsUrlShortcut,
} from '../main/windowsShortcut.js';

test('resolves environment variables and strips resource indexes from shortcut icon paths', () => {
  assert.deepEqual(
    getWindowsShortcutIconCandidates(
      'C:\\Users\\User\\Desktop\\App.lnk',
      {
        icon: '%ProgramFiles%\\Example\\app.exe,-12',
        target: 'C:\\Example\\app.exe',
      },
      { ProgramFiles: 'C:\\Program Files' },
    ),
    [
      'C:\\Program Files\\Example\\app.exe',
      'C:\\Example\\app.exe',
      'C:\\Users\\User\\Desktop\\App.lnk',
    ],
  );
});

test('preserves a resource index embedded in the shortcut icon path', () => {
  assert.deepEqual(
    getWindowsShortcutIconSources(
      'C:\\Apps\\app.lnk',
      { icon: '%ProgramFiles%\\Example\\app.exe,-12' },
      { ProgramFiles: 'C:\\Program Files' },
    ),
    [
      { path: 'C:\\Program Files\\Example\\app.exe', iconIndex: -12 },
    ],
  );
});

test('skips unresolved icon variables and removes duplicate candidate paths', () => {
  assert.deepEqual(
    getWindowsShortcutIconCandidates(
      'C:\\Apps\\app.lnk',
      { icon: '%UNKNOWN%\\app.dll,0', target: 'C:\\Apps\\app.exe' },
      {},
    ),
    ['C:\\Apps\\app.exe', 'C:\\Apps\\app.lnk'],
  );
});

test('preserves the icon resource index for DLL shortcuts', () => {
  assert.deepEqual(
    getWindowsShortcutIconSources(
      'C:\\Apps\\app.lnk',
      {
        icon: 'C:\\Windows\\System32\\shell32.dll, -50',
        iconIndex: -50,
        target: 'C:\\Apps\\app.exe',
      },
    ),
    [
      { path: 'C:\\Windows\\System32\\shell32.dll', iconIndex: -50 },
      { path: 'C:\\Apps\\app.exe', iconIndex: 0 },
    ],
  );
});

test('parses URL shortcut icon files and indexes from the InternetShortcut section', () => {
  assert.deepEqual(
    parseWindowsUrlShortcut(
      '[Other]\nIconFile=ignored.ico\n[InternetShortcut]\nURL=https://example.com/\nIconFile="%LOCALAPPDATA%\\\\Icons\\\\site.ico"\nIconIndex=3',
      'C:\\Users\\User\\Desktop\\site.url',
      { LOCALAPPDATA: 'C:\\Users\\User\\AppData\\Local' },
    ),
    {
      url: 'https://example.com/',
      iconLocation: {
        path: 'C:\\Users\\User\\AppData\\Local\\Icons\\site.ico',
        iconIndex: 3,
      },
    },
  );
});
