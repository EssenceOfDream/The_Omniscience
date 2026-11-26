import { mkdir, open, stat } from 'node:fs/promises';
import path from 'node:path';
import absoluteDirectory from './absoluteDirectory.mjs';
import safeEntryName from './safeEntryName.mjs';

export default async function (payload, kind) {
  const parentPath = absoluteDirectory({ path: payload?.parentPath });
  const name = safeEntryName(payload?.name);
  const parentInfo = await stat(parentPath);
  if (!parentInfo.isDirectory()) throw new Error('Parent path is not a directory');
  const targetPath = path.join(parentPath, name);

  if (kind === 'folder') {
    await mkdir(targetPath);
  } else {
    const handle = await open(targetPath, 'wx');
    await handle.close();
  }
  return { path: targetPath };
}