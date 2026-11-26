import {
  lstat,
  readFile,
} from 'node:fs/promises';
import path from 'node:path';

export default async function(directory, relativePath) {
  if (typeof relativePath !== 'string'
    || !relativePath
    || relativePath.includes('\\')
    || path.posix.isAbsolute(relativePath)
    || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid extension resource path');
  }
  const filePath = path.resolve(directory, ...relativePath.split('/'));
  const relative = path.relative(directory, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Extension resource path escapes its extension directory');
  }
  const info = await lstat(filePath);
  if (!info.isFile()) throw new Error(`Extension resource is not a file: ${relativePath}`);
  return readFile(filePath, 'utf8');
}