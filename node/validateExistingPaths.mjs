import { lstat } from 'node:fs/promises';
import absoluteFilePath from './absoluteFilePath.mjs';

export default async function (paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('At least one file path is required');
  }
  const resolvedPaths = paths.map(absoluteFilePath);
  for (const filePath of resolvedPaths) await lstat(filePath);
  return resolvedPaths;
}