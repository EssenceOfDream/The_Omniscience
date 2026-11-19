import test from 'node:test';
import assert from 'node:assert/strict';
import { getOverviewBounds } from '../main/overviewBounds.js';

test('overview spans the full display width below the top bar', () => {
  assert.deepEqual(
    getOverviewBounds(
      { x: 0, y: 0, width: 1920, height: 1080 },
      { x: 112, y: 40, width: 1808, height: 28 },
    ),
    { x: 0, y: 68, width: 1920, height: 1012 },
  );
});

test('overview preserves display origin on offset displays', () => {
  assert.deepEqual(
    getOverviewBounds(
      { x: 1920, y: 0, width: 1280, height: 1024 },
      { x: 2032, y: 40, width: 1168, height: 28 },
    ),
    { x: 1920, y: 68, width: 1280, height: 956 },
  );
});
