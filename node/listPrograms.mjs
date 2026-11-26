import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import categories from './categories.mjs';
import {
  findComponentAppEntry,
  getComponentAppHtml,
  listComponentAppSources,
} from '../main/componentapps.js';
import hasBuiltProgram from './hasBuiltProgram.mjs';

export default async function (projectRoot, platform = process.platform) {
  const programs = [];

  for (const category of categories) {
    if (category === 'componentapps') {
      for (const app of listComponentAppSources(projectRoot)) {
        const hasEntry = Boolean(getComponentAppHtml(app) || findComponentAppEntry(app));
        const built = hasEntry && await hasBuiltProgram(projectRoot, category, app.name);
        programs.push({
          id: `${category}:${app.name}`,
          name: app.name,
          category,
          entryPoint: hasEntry ? path.join(category, app.name, 'index.html') : null,
          launchable: built && (app.name !== 'windows-settings' || platform === 'win32'),
        });
      }
      continue;
    }

    const categoryPath = path.join(projectRoot, category);
    let entries;
    try {
      entries = await readdir(categoryPath, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('PASTE ')) continue;

      const directory = path.join(categoryPath, entry.name);
      const indexPath = path.join(directory, 'index.html');
      let entryPoint = null;
      try {
        if ((await stat(indexPath)).isFile()) {
          entryPoint = path.join(category, entry.name, 'index.html');
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      programs.push({
        id: `${category}:${entry.name}`,
        name: entry.name,
        category,
        entryPoint,
        launchable: category === 'webapps' && await hasBuiltProgram(projectRoot, category, entry.name),
      });
    }
  }

  return programs.sort((left, right) =>
    left.category.localeCompare(right.category) || left.name.localeCompare(right.name));
}