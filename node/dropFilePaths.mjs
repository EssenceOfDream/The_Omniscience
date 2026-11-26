import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { lstat, copyFile, cp, rename, rm, stat } from 'node:fs/promises';
import absoluteDirectory from './absoluteDirectory.mjs';
import isPathInside from './isPathInside.mjs';
import validateExistingPaths from './validateExistingPaths.mjs';

export default async function (payload) {
  const sources = await validateExistingPaths(payload?.paths);
  const directory = absoluteDirectory({ path: payload?.dir });
  if (!(await stat(directory)).isDirectory()) throw new Error('Drop destination is not a directory');

  const results = [];
  for (const source of sources) {
    const destination = path.join(directory, path.basename(source));
    try {
      if (path.dirname(source) === directory) {
        throw new Error('Source and destination are the same directory');
      }
      const sourceInfo = await lstat(source);
      if (sourceInfo.isDirectory() && isPathInside(directory, source)) {
        throw new Error('A directory cannot be dropped into itself');
      }
      try {
        await lstat(destination);
        throw Object.assign(new Error('Destination already exists'), { code: 'EEXIST' });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const isMove = payload?.isMove === true;
      if (isMove) {
        try {
          await rename(source, destination);
        } catch (error) {
          if (error.code !== 'EXDEV') throw error;
          await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
          await rm(source, { recursive: true, force: false });
        }
      } else {
        if (sourceInfo.isDirectory()) {
          await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
        } else {
          await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
        }
      }
      results.push({ source, destination, success: true });
    } catch (error) {
      results.push({ source, destination, success: false, error: error.message });
    }
  }
  return { success: results.every((result) => result.success), results };
}