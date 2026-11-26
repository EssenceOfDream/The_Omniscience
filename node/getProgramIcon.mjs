import path from 'node:path';
import { readFile } from 'node:fs/promises';

export default async function (projectRoot, category, name) {
  const mimeTypes = {
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  for (const extension of Object.keys(mimeTypes)) {
    try {
      const icon = await readFile(path.join(projectRoot, category, name, `favicon${extension}`));
      return `data:${mimeTypes[extension]};base64,${icon.toString('base64')}`;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  return null;
}