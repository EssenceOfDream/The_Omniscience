import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapNativeWindowForTopbar,
  selectTaskbarHiddenWindows,
} from '../main/hiddenWindows.js';

test('selects only windows hidden from the Explorer taskbar', () => {
  const windows = [
    { id: 'normal', taskbarHidden: false },
    { id: 'tool', taskbarHidden: true },
    { id: 'owned', taskbarHidden: true, isHidden: false },
  ];

  assert.deepEqual(
    selectTaskbarHiddenWindows(windows).map((window) => [window.id, window.isHidden]),
    [['tool', true], ['owned', true]],
  );
});

test('preserves taskbar visibility when mapping native windows into TopBar state', () => {
  const window = mapNativeWindowForTopbar({
    id: '123',
    title: 'Glitch Frame',
    pid: 456,
    visible: true,
    taskbarHidden: true,
    imagePath: 'C:\\Apps\\CODERROR.exe',
  }, '123', null);

  assert.equal(window.visible, true);
  assert.equal(window.taskbarHidden, true);
  assert.equal(window.processName, 'CODERROR');
  assert.deepEqual(selectTaskbarHiddenWindows([window]).map((item) => item.title), ['Glitch Frame']);
});
