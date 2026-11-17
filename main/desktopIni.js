import path from 'path';

function getIniValue(values, name) {
  return values.get(name.toLowerCase()) || '';
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function expandEnvironmentVariables(value, env) {
  return value.replace(/%([^%]+)%/g, (match, name) => {
    const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key ? env[key] : match;
  });
}

function resolveIconPath(value, directoryPath, env, pathApi) {
  if (!value) return null;
  const expanded = expandEnvironmentVariables(unquote(value), env);
  return pathApi.isAbsolute(expanded)
    ? pathApi.normalize(expanded)
    : pathApi.resolve(directoryPath, expanded);
}

export function decodeDesktopIni(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const littleEndian = Buffer.alloc(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      littleEndian[i - 2] = buffer[i + 1];
      littleEndian[i - 1] = buffer[i];
    }
    return littleEndian.toString('utf16le');
  }

  const content = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (!content.includes('\uFFFD')) return content;
  return new TextDecoder('windows-1251').decode(buffer);
}

export function parseDesktopIni(content, directoryPath, env = process.env) {
  const values = new Map();
  let inShellClassInfo = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      inShellClassInfo = line.slice(1, -1).trim().toLowerCase() === '.shellclassinfo';
      continue;
    }
    if (!inShellClassInfo) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (!key) continue;
    values.set(key, unquote(line.slice(separator + 1)));
  }

  const pathApi = /^[a-z]:\\/i.test(directoryPath) ? path.win32 : path;
  const localizedName = getIniValue(values, 'LocalizedResourceName');
  const infoTip = getIniValue(values, 'InfoTip');
  const iconResource = getIniValue(values, 'IconResource');
  const iconFile = getIniValue(values, 'IconFile');
  const iconResourceSeparator = iconResource.lastIndexOf(',');
  const resourcePath = iconResourceSeparator > 0
    && /^-?\d+$/.test(iconResource.slice(iconResourceSeparator + 1).trim())
    ? iconResource.slice(0, iconResourceSeparator)
    : iconResource;
  const resolvedIconPath = resolveIconPath(
    resourcePath || iconFile,
    directoryPath,
    env,
    pathApi,
  );
  const iconPath = resolvedIconPath && pathApi.extname(resolvedIconPath).toLowerCase() === '.ico'
    ? resolvedIconPath
    : null;

  return {
    localizedName: localizedName && !localizedName.startsWith('@') ? localizedName : null,
    infoTip: infoTip && !infoTip.startsWith('@') ? infoTip : null,
    iconPath,
  };
}
