import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveActiveWindow } from '../main/topbarActiveWindow.js';

test('prefers the currently focused window over the stale last Electron window', () => {
  const windows = [
    { id: 'electron-window', focused: false },
    { id: 'native-window', focused: true },
  ];

  assert.equal(resolveActiveWindow(windows, 'electron-window'), windows[1]);
});

test('falls back to the last focused window only when none is currently focused', () => {
  const windows = [
    { id: 'first-window', focused: false },
    { id: 'last-window', focused: false },
  ];

  assert.equal(resolveActiveWindow(windows, 'last-window'), windows[1]);
  assert.equal(resolveActiveWindow(windows, 'closed-window'), windows[0]);
  assert.equal(resolveActiveWindow([], 'last-window'), null);
});
