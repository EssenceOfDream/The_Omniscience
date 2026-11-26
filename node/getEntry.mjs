import { lstat } from 'node:fs/promises';

export default async function (filePath, name) {
  const info = await lstat(filePath);
  const kind = info.isDirectory()
    ? 'directory'
    : info.isFile()
      ? 'file'
      : info.isSymbolicLink()
        ? 'symlink'
        : 'other';
  return {
    name,
    path: filePath,
    kind,
    size: info.size,
    modifiedAt: info.mtimeMs,
  };
}