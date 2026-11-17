import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDesktopEntries } from '../main/desktopEntries.js';

const entry = (name) => ({ name });

test('merges Public Desktop items while keeping user Desktop duplicates', () => {
  const userEntries = [entry('Browser.lnk'), entry('Project')];
  const publicEntries = [entry('browser.LNK'), entry('Shared.lnk')];

  assert.deepEqual(
    mergeDesktopEntries(userEntries, publicEntries, 'C:\\Users\\User\\Desktop', 'C:\\Users\\Public\\Desktop'),
    [
      { entry: userEntries[0], directory: 'C:\\Users\\User\\Desktop' },
      { entry: userEntries[1], directory: 'C:\\Users\\User\\Desktop' },
      { entry: publicEntries[1], directory: 'C:\\Users\\Public\\Desktop' },
    ],
  );
});
