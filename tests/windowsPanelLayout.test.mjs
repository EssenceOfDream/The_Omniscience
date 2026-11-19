import test from 'node:test';
import assert from 'node:assert/strict';
import { getWindowsPanelLayout } from '../main/windowsPanelLayout.js';

test('joins the Omniscience row to the right of top controls below the Windows taskbar', () => {
  const layout = getWindowsPanelLayout(
    { x: 20, y: 10, width: 1920, height: 1080 },
    { x: 20, y: 10, width: 1920, height: 40 },
    28,
    112,
  );

  assert.deepEqual(layout, {
    topbar: { x: 132, y: 50, width: 1808, height: 28 },
    controls: { x: 20, y: 50, width: 112, height: 68 },
  });
});

test('keeps the composite panel at the top even if Explorer is still at the bottom', () => {
  const layout = getWindowsPanelLayout(
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 0, y: 1040, width: 1920, height: 40 },
    28,
    112,
  );

  assert.deepEqual(layout, {
    topbar: { x: 112, y: 40, width: 1808, height: 28 },
    controls: { x: 0, y: 40, width: 112, height: 68 },
  });
});

test('rejects invalid display and taskbar dimensions', () => {
  assert.throws(
    () => getWindowsPanelLayout(
      { x: 0, y: 0, width: 0, height: 1080 },
      { x: 0, y: 0, width: 1920, height: 40 },
      28,
      112,
    ),
    /Invalid display or taskbar bounds/,
  );
});
