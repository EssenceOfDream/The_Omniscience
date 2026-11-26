import { lstat, rename } from 'node:fs/promises';
import path from 'node:path';
import safeEntryName from './safeEntryName.mjs';

export default async function (payload) {
  const sourcePath = payload?.path;
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    throw new Error('An absolute source path is required');
  }
  const resolvedSource = path.resolve(sourcePath);
  const name = safeEntryName(payload?.name);
  const targetPath = path.join(path.dirname(resolvedSource), name);
  if (resolvedSource === targetPath) return { path: resolvedSource };

  try {
    await lstat(targetPath);
    throw new Error('EEXIST');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await rename(resolvedSource, targetPath);
  return { path: targetPath };
}