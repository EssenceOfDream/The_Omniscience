import path from 'node:path';
import { Script } from 'node:vm';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';

import DEFAULT_EXTENSION_TARGETS from './DEFAULT_EXTENSION_TARGETS.mjs';

export function extensionDirectory(projectRoot, extensionId) {
  if (typeof extensionId !== 'string'
    || !extensionId
    || path.basename(extensionId) !== extensionId
    || extensionId.startsWith('.')
    || /[<>:"/\\|?*\u0000-\u001f]/.test(extensionId)) {
    throw new Error('Invalid extension id');
  }
  return path.join(projectRoot, 'extensions', extensionId);
}

export async function readExtensionFile(directory, relativePath) {
  if (typeof relativePath !== 'string'
    || !relativePath
    || relativePath.includes('\\')
    || path.posix.isAbsolute(relativePath)
    || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid extension resource path');
  }
  const filePath = path.resolve(directory, ...relativePath.split('/'));
  const relative = path.relative(directory, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Extension resource path escapes its extension directory');
  }
  const info = await lstat(filePath);
  if (!info.isFile()) throw new Error(`Extension resource is not a file: ${relativePath}`);
  return readFile(filePath, 'utf8');
}

export async function loadExtension(projectRoot, extensionId, { includeSources = false } = {}) {
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

export async function listExtensions(projectRoot) {
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

export async function getExtensionRuntime(projectRoot) {
  const extensions = await listExtensions(projectRoot);
  return Promise.all(extensions.map(({ id }) =>
    loadExtension(projectRoot, id, { includeSources: true })));
}

export function extensionStoragePath(context, extensionId) {
  const defaultDirectory = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'The_Omniscience', 'extensions')
    : path.join(os.homedir(), '.the-omniscience', 'extensions');
  return path.join(
    context.extensionStoragePath ?? defaultDirectory,
    `${extensionId}.json`,
  );
}

export async function readExtensionStorage(context, extensionId) {
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

export async function writeExtensionStorage(context, extensionId, items, removeKeys = [], clear = false) {
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