import path from 'node:path';
import { readdir } from 'node:fs/promises';

export default async function collectStartMenuShortcuts(directory, apps, seen) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return;
    throw error;
  }

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectStartMenuShortcuts(filePath, apps, seen);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!entry.isFile() || (extension !== '.lnk' && extension !== '.url')) continue;
    const id = `native:${filePath.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    apps.push({
      id,
      name: path.basename(entry.name, extension),
      launchType: 'shortcut',
      launchTarget: filePath,
      icon: null,
    });
  }
}

// Внимание: рекурсивный вызов по имени — работает, т.к. default-биндинг
// hoisted в ESM. Это тот же приём, что и в оригинале.