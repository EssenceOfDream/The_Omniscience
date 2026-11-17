import test from 'node:test';
import assert from 'node:assert/strict';
import { clampBoundsToWorkArea } from '../main/windowBounds.js';

const workArea = { x: 10, y: 30, width: 1000, height: 700 };

test('window bounds stay inside the work area on every edge', () => {
  assert.deepEqual(
    clampBoundsToWorkArea({ x: -40, y: -20, width: 300, height: 200 }, workArea),
    { x: 10, y: 30, width: 300, height: 200 },
  );
  assert.deepEqual(
    clampBoundsToWorkArea({ x: 950, y: 680, width: 300, height: 200 }, workArea),
    { x: 710, y: 530, width: 300, height: 200 },
  );
});

test('oversized windows are reduced to the work area', () => {
  assert.deepEqual(
    clampBoundsToWorkArea({ x: -50, y: -50, width: 1400, height: 900 }, workArea),
    workArea,
  );
});
