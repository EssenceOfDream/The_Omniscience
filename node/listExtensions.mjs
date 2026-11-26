import {
  readdir,
} from 'node:fs/promises';
import path from 'node:path';
import loadExtension from './loadExtension.mjs';

export default async function(projectRoot) {
  const root = path.join(projectRoot, 'extensions');
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const extensions = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const extension = await loadExtension(projectRoot, entry.name);
      extensions.push({
        id: extension.id,
        extensionId: extension.id,
        title: extension.title,
        name: extension.name,
        type: 'extension',
        kind: 'extension',
        launchable: Boolean(extension.popup),
        version: extension.version,
        description: extension.description,
        icon: extension.icon,
      });
    } catch (error) {
      console.error(`[extensions] failed to load ${entry.name}:`, error);
    }
  }
  return extensions.sort((left, right) => left.title.localeCompare(right.title));
}