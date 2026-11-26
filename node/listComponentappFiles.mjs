import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import absoluteDirectory from './absoluteDirectory.mjs';

export default async function (rawPath) {
  const directory = absoluteDirectory({ path: rawPath });
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      const info = await stat(entryPath);
      return {
        id: entryPath,
        name: entry.name,
        isDir: info.isDirectory(),
        size: info.size,
        modDate: info.mtime.toISOString(),
      };
    }));
    return { success: true, files };
  } catch (error) {
    return {
      success: false,
      error: error.code === 'EACCES' || error.code === 'EPERM'
        ? 'permission_denied'
        : 'unknown',
    };
  }
}