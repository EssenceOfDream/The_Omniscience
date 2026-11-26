import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import absoluteDirectory from './absoluteDirectory.mjs';
import getEntry from './getEntry.mjs';

export default async function (payload) {
  const directory = absoluteDirectory(payload);
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error('Path is not a directory');
  const names = await readdir(directory);
  const entries = await Promise.all(names.map((name) =>
    getEntry(path.join(directory, name), name)));
  entries.sort((left, right) =>
    Number(right.kind === 'directory') - Number(left.kind === 'directory')
    || left.name.localeCompare(right.name));
  return { path: directory, entries };
}