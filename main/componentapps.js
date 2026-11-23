import fs from 'node:fs';
import path from 'node:path';

export function listComponentAppSources(projectRoot) {
  const roots = [
    { path: path.join(projectRoot, 'legacy', 'componentapps'), priority: 0 },
    { path: path.join(projectRoot, 'componentapps'), priority: 1 },
  ];
  const apps = new Map();

  for (const root of roots) {
    if (!fs.existsSync(root.path)) continue;
    for (const entry of fs.readdirSync(root.path, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')
        || entry.name.startsWith('PASTE ')) continue;
      const app = apps.get(entry.name) || { name: entry.name, sources: [] };
      app.sources.push({
        directory: path.join(root.path, entry.name),
        priority: root.priority,
      });
      apps.set(entry.name, app);
    }
  }

  return [...apps.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function findComponentAppEntry(app) {
  const candidates = ['Index.tsx', 'Index.ts', 'Index.jsx', 'Index.js'];
  for (const source of [...app.sources].sort((a, b) => b.priority - a.priority)) {
    for (const name of candidates) {
      const entry = path.join(source.directory, name);
      if (fs.existsSync(entry) && fs.statSync(entry).isFile()) return entry;
    }
  }
  return null;
}

export function getComponentAppHtml(app) {
  for (const source of [...app.sources].sort((a, b) => b.priority - a.priority)) {
    const html = path.join(source.directory, 'index.html');
    if (fs.existsSync(html) && fs.statSync(html).isFile()) return html;
  }
  return null;
}
