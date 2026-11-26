import path from 'node:path';
import { Script } from 'node:vm';
import {
  lstat,
  readFile,
} from 'node:fs/promises';

import DEFAULT_EXTENSION_TARGETS from './DEFAULT_EXTENSION_TARGETS.mjs';

import extensionDirectory from './extensionDirectory.mjs';
import readExtensionFile from './readExtensionFile.mjs';

export default async function(projectRoot, extensionId, { includeSources = false } = {}) {
  const directory = extensionDirectory(projectRoot, extensionId);
  const manifestPath = path.join(directory, 'manifest.json');
  if (!(await lstat(manifestPath)).isFile()) {
    throw new Error(`Extension ${extensionId} manifest is not a regular file`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest || manifest.manifest_version !== 3
    || typeof manifest.name !== 'string' || !manifest.name.trim()
    || typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error(`Extension ${extensionId} must have a valid Manifest V3 manifest`);
  }

  const omniscience = manifest.omniscience ?? {};
  if (!omniscience || typeof omniscience !== 'object' || Array.isArray(omniscience)) {
    throw new Error(`Extension ${extensionId} has an invalid omniscience manifest`);
  }
  const targetOverrides = omniscience.targets ?? {};
  if (!targetOverrides || typeof targetOverrides !== 'object' || Array.isArray(targetOverrides)) {
    throw new Error(`Extension ${extensionId} has invalid omniscience targets`);
  }
  const targets = { ...DEFAULT_EXTENSION_TARGETS };
  for (const [target, enabled] of Object.entries(targetOverrides)) {
    if (!Object.hasOwn(DEFAULT_EXTENSION_TARGETS, target) || typeof enabled !== 'boolean') {
      throw new Error(`Extension ${extensionId} has an invalid omniscience target: ${target}`);
    }
    targets[target] = enabled;
  }

  const loadScriptEntries = async (entries, section, { supportsRunAt = false } = {}) => {
    if (!Array.isArray(entries)) throw new Error(`Extension ${extensionId} ${section} must be an array`);
    const scripts = [];
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.matches) || entry.matches.length === 0
        || entry.matches.some((match) => typeof match !== 'string')) {
        throw new Error(`Extension ${extensionId} ${section} requires match patterns`);
      }
      if (!supportsRunAt && Object.hasOwn(entry, 'run_at')) {
        throw new Error(`Extension ${extensionId} preloads must not define run_at`);
      }
      const css = await Promise.all((entry.css ?? []).map((file) => readExtensionFile(directory, file)));
      const js = await Promise.all((entry.js ?? []).map(async (file) => {
        const source = await readExtensionFile(directory, file);
        try {
          new Script(source, { filename: `${extensionId}/${file}` });
        } catch (error) {
          throw new Error(`Invalid JavaScript in ${extensionId}/${file}: ${error.message}`);
        }
        return source;
      }));
      scripts.push({
        matches: entry.matches,
        ...(supportsRunAt ? {
          runAt: ['document_start', 'document_end', 'document_idle'].includes(entry.run_at)
            ? entry.run_at
            : 'document_idle',
        } : {}),
        css,
        js,
      });
    }
    return scripts;
  };

  const preloads = await loadScriptEntries(omniscience.preloads ?? [], 'omniscience.preloads');
  const contentScripts = await loadScriptEntries(
    manifest.content_scripts ?? [],
    'content_scripts',
    { supportsRunAt: true },
  );

  const action = manifest.action ?? manifest.browser_action ?? {};
  const popup = typeof action.default_popup === 'string' && action.default_popup
    ? action.default_popup
    : null;
  if (popup) await readExtensionFile(directory, popup);

  let icon = null;
  const icons = manifest.icons && typeof manifest.icons === 'object' ? manifest.icons : {};
  const iconPath = Object.entries(icons)
    .sort(([left], [right]) => Number(right) - Number(left))
    .map(([, value]) => value)
    .find((value) => typeof value === 'string');
  if (iconPath) {
    if (iconPath.includes('\\')
      || path.posix.isAbsolute(iconPath)
      || iconPath.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('Invalid extension icon path');
    }
    const extension = path.extname(iconPath).toLowerCase();
    const mimeType = {
      '.ico': 'image/x-icon',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    }[extension];
    if (mimeType) {
      const filePath = path.resolve(directory, ...iconPath.split('/'));
      const relative = path.relative(directory, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Extension icon path escapes its extension directory');
      }
      const info = await lstat(filePath);
      if (!info.isFile()) throw new Error('Extension icon is not a file');
      const contents = await readFile(filePath);
      icon = `data:${mimeType};base64,${contents.toString('base64')}`;
    }
  }

  return {
    id: extensionId,
    title: manifest.name.trim(),
    name: manifest.name.trim(),
    version: manifest.version,
    description: typeof manifest.description === 'string' ? manifest.description : '',
    icon,
    popup,
    targets,
    preloads: includeSources ? preloads : preloads.map(({ matches, runAt, css }) => ({
      matches, ...(runAt ? { runAt } : {}), css,
    })),
    contentScripts: includeSources ? contentScripts : undefined,
  };
}