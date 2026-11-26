import {
  mkdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import readExtensionStorage from './readExtensionStorage.mjs';
import extensionStoragePath from './extensionStoragePath.mjs';

export default async function(context, extensionId, items, removeKeys = [], clear = false) {
  if (!items || typeof items !== 'object' || Array.isArray(items)) {
    throw new Error('Extension storage items must be an object');
  }
  const oldValues = await readExtensionStorage(context, extensionId);
  const newValues = clear ? {} : { ...oldValues, ...items };
  for (const key of removeKeys) delete newValues[key];
  for (const [key, value] of Object.entries(items)) {
    if (value === undefined) delete newValues[key];
  }
  const storageFile = extensionStoragePath(context, extensionId);
  await mkdir(path.dirname(storageFile), { recursive: true });
  await writeFile(storageFile, JSON.stringify(newValues), 'utf8');
  const changes = {};
  const changedKeys = new Set([...Object.keys(items), ...removeKeys, ...(clear ? Object.keys(oldValues) : [])]);
  for (const key of changedKeys) {
    if (Object.hasOwn(oldValues, key) && Object.hasOwn(newValues, key)
      && JSON.stringify(oldValues[key]) === JSON.stringify(newValues[key])) continue;
    changes[key] = {};
    if (Object.hasOwn(newValues, key)) changes[key].newValue = newValues[key];
    if (Object.hasOwn(oldValues, key)) changes[key].oldValue = oldValues[key];
  }
  return changes;
}