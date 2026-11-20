import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEverythingExecutableCandidates,
  parseEverythingRegistryPath,
  resolveEverythingExecutable,
} from '../main/everythingSearch.js';

test('finds standard per-machine and per-user Everything install locations', () => {
  assert.deepEqual(
    getEverythingExecutableCandidates({
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\User\\AppData\\Local',
    }),
    [
      'C:\\Program Files\\Everything\\Everything.exe',
      'C:\\Program Files (x86)\\Everything\\Everything.exe',
      'C:\\Users\\User\\AppData\\Local\\Programs\\Everything\\Everything.exe',
    ],
  );
});

test('reads the registered executable path, including a quoted path', () => {
  assert.equal(
    parseEverythingRegistryPath('    (Default)    REG_SZ    "D:\\Apps\\Everything.exe"\r\n'),
    'D:\\Apps\\Everything.exe',
  );
});

test('resolves a custom Everything location from App Paths', async () => {
  const customPath = 'D:\\Apps\\Everything.exe';
  const found = await resolveEverythingExecutable({
    env: {},
    fileExists: (candidate) => candidate === customPath,
    readRegistryPath: async () => customPath,
  });

  assert.equal(found, customPath);
});
