import test from 'node:test';
import assert from 'node:assert/strict';
import { forceWindowPlacementAboveTaskbar } from '../main/topbarPlacement.js';

function createWindow(initialBounds) {
  const calls = [];
  let bounds = initialBounds;
  let alwaysOnTop = false;
  return {
    calls,
    isDestroyed: () => false,
    setBounds: (next) => {
      calls.push(['setBounds', next]);
      bounds = next;
    },
    getBounds: () => bounds,
    isAlwaysOnTop: () => alwaysOnTop,
    setAlwaysOnTop: (value, level) => {
      calls.push(['setAlwaysOnTop', value, level]);
      alwaysOnTop = value;
    },
    moveTop: () => calls.push(['moveTop']),
  };
}

test('forces the panel to its expected top bounds and above the taskbar', () => {
  const bounds = { x: 112, y: 40, width: 1808, height: 28 };
  const window = createWindow({ x: 112, y: 1040, width: 1808, height: 28 });

  assert.equal(forceWindowPlacementAboveTaskbar(window, bounds), true);
  assert.deepEqual(window.calls, [
    ['setBounds', bounds],
    ['setAlwaysOnTop', true, 'screen-saver'],
    ['moveTop'],
  ]);
});

test('reports when Windows refuses the requested panel bounds', () => {
  const bounds = { x: 112, y: 40, width: 1808, height: 28 };
  const window = createWindow({ x: 112, y: 1040, width: 1808, height: 28 });
  window.setBounds = () => {};

  assert.throws(
    () => forceWindowPlacementAboveTaskbar(window, bounds),
    /window bounds did not apply/,
  );
});
