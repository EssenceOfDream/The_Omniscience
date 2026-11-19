import fsp from 'fs/promises';
import path from 'path';

export async function enumeratePaths(inputPaths) {
  const directories = [];
  const files = [];
  let totalBytes = 0;

  for (const p of inputPaths) {
    const st = await fsp.lstat(p);
    if (st.isSymbolicLink()) continue;
    const base = path.basename(p);

    if (st.isDirectory()) {
      directories.push(base);
      await walk(p, base, directories, files, (n) => { totalBytes += n; });
    } else if (st.isFile()) {
      files.push({ source: p, destRelative: base, size: st.size });
      totalBytes += st.size;
    }
  }

  return { directories, files, totalBytes };
}

async function walk(dirPath, relPath, directories, files, addBytes) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dirPath, e.name);
    const rel = path.join(relPath, e.name);
    if (e.isDirectory()) {
      directories.push(rel);
      await walk(full, rel, directories, files, addBytes);
    } else if (e.isFile()) {
      const st = await fsp.stat(full);
      files.push({ source: full, destRelative: rel, size: st.size });
      addBytes(st.size);
    }
  }
}