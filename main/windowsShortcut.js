import path from 'path';
import { decodeDesktopIni } from './desktopIni.js';

function expandEnvironmentVariables(value, env) {
  return value.replace(/%([^%]+)%/g, (match, name) => {
    const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key ? env[key] : match;
  });
}

function normalizeIconLocation(iconPath, iconIndex, env) {
  if (typeof iconPath !== 'string' || !iconPath.trim()) return null;

  let normalized = expandEnvironmentVariables(iconPath.trim().replace(/^"(.*)"$/, '$1'), env);
  let resourceIndex = iconIndex == null ? 0 : Number(iconIndex);
  normalized = normalized.replace(/((?:\.exe|\.dll|\.ico|\.icl|\.cpl)),\s*(-?\d+)$/i, (_match, filePath, index) => {
    if (iconIndex == null) resourceIndex = Number(index);
    return filePath;
  });
  if (/%[^%]+%/.test(normalized)) return null;
  return {
    path: path.win32.normalize(normalized),
    iconIndex: Number.isInteger(resourceIndex) ? resourceIndex : 0,
  };
}

export function getWindowsShortcutIconCandidates(shortcutPath, shortcut, env = process.env) {
  return getWindowsShortcutIconSources(shortcutPath, shortcut, env)
    .map((source) => source.path)
    .concat(shortcutPath);
}

export function getWindowsShortcutIconSources(shortcutPath, shortcut, env = process.env) {
  const sources = [
    normalizeIconLocation(shortcut?.icon, shortcut?.iconIndex, env),
    normalizeIconLocation(shortcut?.target, 0, env),
  ].filter(Boolean);
  const seen = new Set();
  return sources.filter((source) => {
    const key = `${source.path.toLowerCase()}|${source.iconIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseWindowsUrlShortcut(content, shortcutPath, env = process.env) {
  const decoded = Buffer.isBuffer(content) ? decodeDesktopIni(content) : content.replace(/^\uFEFF/, '');
  const values = new Map();
  let inInternetShortcut = false;

  for (const rawLine of decoded.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      inInternetShortcut = line.slice(1, -1).trim().toLowerCase() === 'internetshortcut';
      continue;
    }
    if (!inInternetShortcut) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    values.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }

  const iconLocation = normalizeIconLocation(values.get('iconfile'), values.get('iconindex'), env);
  if (iconLocation && !path.win32.isAbsolute(iconLocation.path)) {
    iconLocation.path = path.win32.resolve(path.win32.dirname(shortcutPath), iconLocation.path);
  }

  return {
    url: values.get('url') || null,
    iconLocation,
  };
}
