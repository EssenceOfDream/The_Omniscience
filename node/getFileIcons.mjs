import { stat } from 'node:fs/promises';

import absoluteFilePath from './absoluteFilePath.mjs';
import getWindowsIcons from './getWindowsIcons.mjs';

export default async function (payload, context) {
  const paths = Array.isArray(payload?.paths) ? payload.paths : [];
  const resolvedPaths = paths.map(absoluteFilePath);
  const entries = await Promise.all(resolvedPaths.map(async (filePath) => {
    try {
      const info = await stat(filePath);
      return info.isFile() || info.isDirectory() ? filePath : null;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    }
  }));
  const validPaths = entries.filter(Boolean);
  const platform = typeof context === 'string'
    ? process.platform
    : context.platform ?? process.platform;
  if (platform !== 'win32') return Object.fromEntries(resolvedPaths.map((filePath) => [filePath, null]));

  const icons = await getWindowsIcons(
    validPaths.map((filePath) => ({ id: filePath, path: filePath })),
    context,
  );
  return Object.fromEntries(resolvedPaths.map((filePath, index) => [
    filePath,
    entries[index] ? icons.get(filePath) || null : null,
  ]));
}