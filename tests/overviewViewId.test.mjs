import test from 'node:test';
import assert from 'node:assert/strict';
import { getOverviewViewId } from '../src/components/overviewViewId.js';

test('gives each overview window its own stable child view ID', () => {
  assert.equal(getOverviewViewId('__overview__:10', 'apps-list'), 'overview:__overview__:10:apps-list');
  assert.notEqual(
    getOverviewViewId('__overview__:10', 'apps-list'),
    getOverviewViewId('__overview__:11', 'apps-list'),
  );
});
