import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stat, writeFile } from 'node:fs/promises';
import absoluteDirectory from './absoluteDirectory.mjs';

export default async function (payload) {
  const directory = absoluteDirectory({ path: payload?.dir });
  if (!(await stat(directory)).isDirectory()) throw new Error('Drop destination is not a directory');
  if (!Array.isArray(payload?.files) || payload.files.length === 0) {
    throw new Error('At least one dropped file is required');
  }

  const results = [];
  for (const file of payload.files) {
    try {
      const rawName = typeof file?.name === 'string' ? file.name.trim() : '';
      const name = rawName
        ? rawName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        : `dropped-${randomUUID()}.bin`;
      if (name === '.' || name === '..') throw new Error('Dropped file name is invalid');
      let bytes;
      if (Array.isArray(file?.data)) {
        if (file.data.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
          throw new Error('Dropped file data is invalid');
        }
        bytes = Buffer.from(file.data);
      } else if (file?.data && typeof file.data === 'object') {
        const values = Object.keys(file.data)
          .filter((key) => /^\d+$/.test(key))
          .sort((left, right) => Number(left) - Number(right))
          .map((key) => file.data[key]);
        if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
          throw new Error('Dropped file data is invalid');
        }
        bytes = Buffer.from(values);
      } else {
        throw new Error('Dropped file data is invalid');
      }

      let destination;
      let suffix = 0;
      while (true) {
        const candidateName = suffix === 0
          ? name
          : `${path.parse(name).name} (${suffix})${path.extname(name)}`;
        destination = path.join(directory, candidateName);
        try {
          await writeFile(destination, bytes, { flag: 'wx' });
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          suffix += 1;
        }
      }
      results.push({ name, destination, success: true });
    } catch (error) {
      results.push({
        name: typeof file?.name === 'string' ? file.name : '',
        success: false,
        error: error.message,
      });
    }
  }
  return { success: results.every((result) => result.success), results };
}