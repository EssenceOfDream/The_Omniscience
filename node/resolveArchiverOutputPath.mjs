import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';

export default async function (rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return { ok: false, error: 'Путь пуст' };
  }
  const outputPath = path.resolve(rawPath.trim().replace(/^"|"$/g, ''));
  try {
    await mkdir(outputPath, { recursive: true });
    const info = await stat(outputPath);
    if (!info.isDirectory()) return { ok: false, error: 'Это не папка' };
    const probe = path.join(outputPath, `.write-test-${randomUUID()}`);
    await writeFile(probe, '');
    await unlink(probe);
    return { ok: true, path: outputPath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}