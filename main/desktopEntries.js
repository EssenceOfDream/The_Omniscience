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
