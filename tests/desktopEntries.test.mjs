import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isWithinDesktopTree, mergeDesktopEntries } from '../main/desktopEntries.js';

test('recognizes descendants of a configured Windows desktop folder only', () => {
  const roots = {
    configuredDesktop: 'D:\\Users\\User\\My Desktop',
  };

  assert.equal(
    isWithinDesktopTree('D:\\Users\\User\\My Desktop\\Projects', roots, path.win32),
    true,
  );
  assert.equal(
    isWithinDesktopTree('D:\\Users\\User\\My Desktop-old\\Projects', roots, path.win32),
    false,
  );
});

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
