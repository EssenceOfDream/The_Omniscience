import path from 'node:path';
import isFile from './isFile.mjs';

export default async function (projectRoot, category, name) {
  const relativePath = path.join(category, name, 'index.html');
  return await isFile(path.join(projectRoot, 'public', 'omniscience', relativePath))
    || await isFile(path.join(projectRoot, 'dist', relativePath));
}