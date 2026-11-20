import path from 'path';

export function isWithinDesktopTree(targetPath, desktopRoots, pathApi = path) {
  if (!desktopRoots) return false;
  return [
    desktopRoots.userDesktop,
    desktopRoots.publicDesktop,
    desktopRoots.configuredDesktop,
  ]
    .filter(Boolean)
    .some((rootPath) => {
      const relativePath = pathApi.relative(rootPath, targetPath);
      return relativePath === ''
        || (relativePath !== '..'
          && !relativePath.startsWith(`..${pathApi.sep}`)
          && !pathApi.isAbsolute(relativePath));
    });
}

export function mergeDesktopEntries(primaryEntries, secondaryEntries, primaryDir, secondaryDir) {
  const seenNames = new Set();
  const merged = [];

  for (const [entries, directory] of [
    [primaryEntries, primaryDir],
    [secondaryEntries, secondaryDir],
  ]) {
    for (const entry of entries) {
      const nameKey = entry.name.toLocaleLowerCase('en-US');
      if (seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);
      merged.push({ entry, directory });
    }
  }

  return merged;
}
