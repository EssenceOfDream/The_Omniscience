import {
  readFile,
} from 'node:fs/promises';

import extensionStoragePath from './extensionStoragePath.mjs';
import loadExtension from './loadExtension.mjs';

export default async function(context, extensionId) {
  await loadExtension(context.projectRoot, extensionId);
  try {
    const contents = await readFile(extensionStoragePath(context, extensionId), 'utf8');
    const values = JSON.parse(contents);
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new Error(`Invalid stored data for extension ${extensionId}`);
    }
    return values;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}