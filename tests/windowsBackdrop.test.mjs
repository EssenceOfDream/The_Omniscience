import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installWindowsBackdropBlur } from '../main/windowsBackdrop.js';

function createWindow() {
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  return window;
}

test('does not request native blur on other platforms', () => {
  const window = createWindow();

  installWindowsBackdropBlur(window, {
    platform: 'linux',
    apply: () => assert.fail('native blur should not be requested'),
  });

  assert.equal(window.listenerCount('ready-to-show'), 0);
  assert.equal(window.listenerCount('show'), 0);
});

test('enables blur once the window is ready and does not repeat after show', async () => {
  const window = createWindow();
  let applyCount = 0;

  installWindowsBackdropBlur(window, {
    platform: 'win32',
    apply: async () => {
      applyCount++;
      return true;
    },
  });

  window.emit('ready-to-show');
  window.emit('show');
  await new Promise((resolve) => setImmediate(resolve));
  window.emit('show');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(applyCount, 1);
});

test('logs a native failure and retries when the window is shown again', async () => {
  const window = createWindow();
  const errors = [];
  let applyCount = 0;

  installWindowsBackdropBlur(window, {
    platform: 'win32',
    apply: async () => {
      applyCount++;
      if (applyCount === 1) throw new Error('DWM unavailable');
      return true;
    },
    logError: (...args) => errors.push(args),
  });

  window.emit('ready-to-show');
  await new Promise((resolve) => setImmediate(resolve));
  window.emit('show');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(applyCount, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0][1], /DWM unavailable/);
});
