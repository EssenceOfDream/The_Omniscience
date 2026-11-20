import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getOverviewSiblingViewIds,
  getViewIdsForParentWindowInstance,
  resolveViewParent,
} from '../main/viewLifecycle.js';

test('does not attach a view to the main window when its explicit parent is missing', () => {
  const mainWindow = { isDestroyed: () => false };
  assert.equal(
    resolveViewParent('__overview__:stale', {
      mainWindow,
      topbarWindow: null,
      getWindowById: () => null,
    }),
    null,
  );
  assert.equal(resolveViewParent(null, { mainWindow, topbarWindow: null }), mainWindow);
});

test('finds only views attached to the exact parent window being closed', () => {
  const oldWindow = {};
  const newWindow = {};
  const views = {
    'overview:old': { parentWindowId: '__overview__', parentWindow: oldWindow },
    'overview:new': { parentWindowId: '__overview__', parentWindow: newWindow },
  };

  assert.deepEqual(
    getViewIdsForParentWindowInstance(views, oldWindow),
    ['overview:old'],
  );
});

test('finds every stale Overview child view without selecting the active view', () => {
  const parentWindow = {};
  const views = {
    'overview:active': { parentWindow, role: 'overview-tab' },
    'overview:stale': { parentWindow, role: 'overview-tab' },
    'window:other': { parentWindow, role: null },
    'legacy:overview': { parentWindow },
    'overview:elsewhere': { parentWindow: {}, role: 'overview-tab' },
  };

  assert.deepEqual(
    getOverviewSiblingViewIds(views, parentWindow, 'overview:active'),
    ['overview:stale', 'window:other', 'legacy:overview'],
  );
});
