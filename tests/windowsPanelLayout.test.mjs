import test from 'node:test';
import assert from 'node:assert/strict';
import { getWindowsPanelLayout } from '../main/windowsPanelLayout.js';

test('places the Omniscience row below a top taskbar and overlays controls on it', () => {
  const layout = getWindowsPanelLayout(
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 0, y: -38, width: 1920, height: 40 },
    36,
    72,
  );

  assert.deepEqual(layout, {
    topbar: { x: 0, y: 40, width: 1920, height: 36 },
    controls: { x: 0, y: 0, width: 72, height: 40 },
  });
});

test('keeps the taskbar overlay and Omniscience row paired when the taskbar is at the bottom', () => {
  const layout = getWindowsPanelLayout(
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 0, y: 1040, width: 1920, height: 40 },
    36,
    72,
  );

  assert.deepEqual(layout, {
    topbar: { x: 0, y: 1004, width: 1920, height: 36 },
    controls: { x: 0, y: 1040, width: 72, height: 40 },
  });
});

test('rejects invalid display and taskbar dimensions', () => {
  assert.throws(
    () => getWindowsPanelLayout(
      { x: 0, y: 0, width: 0, height: 1080 },
      { x: 0, y: 0, width: 1920, height: 40 },
      36,
      112,
    ),
    /Invalid display or taskbar bounds/,
  );
});
