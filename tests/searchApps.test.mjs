import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterApps,
  groupAppsByFirstLetter,
  matchesAppSearch,
} from '../componentapps/apps-list/searchApps.js';

const shortcut = {
  id: 'crossout-shortcut',
  title: 'Crossout',
  kind: 'native',
  fullPath: 'C:\\Users\\User\\Start Menu\\Programs\\Crossout.lnk',
  comment: 'Launch Crossout',
};

test('search matches native shortcuts by displayed title and full path', () => {
  assert.equal(matchesAppSearch(shortcut, 'crossout'), true);
  assert.equal(matchesAppSearch(shortcut, 'start menu'), true);
  assert.equal(matchesAppSearch(shortcut, 'not a match'), false);
});

test('search terms and app-type filters are applied together', () => {
  const apps = [
    shortcut,
    { ...shortcut, id: 'crossout-uwp', launchType: 'uwp' },
  ];

  assert.deepEqual(filterApps(apps, 'native', 'crossout'), [shortcut]);
  assert.deepEqual(filterApps(apps, 'uwp', 'crossout'), [apps[1]]);
});

test('groups non-contiguous app initials into one stable key per letter', () => {
  const apps = [
    { id: 'a1', title: 'Alpha' },
    { id: 'b1', title: 'Beta' },
    { id: 'a2', title: 'Another' },
  ];

  assert.deepEqual(groupAppsByFirstLetter(apps), [
    { letter: 'A', items: [apps[0], apps[2]] },
    { letter: 'B', items: [apps[1]] },
  ]);
});
