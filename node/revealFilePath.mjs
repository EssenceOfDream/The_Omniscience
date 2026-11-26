import { stat } from 'node:fs/promises';
import path from 'node:path';
import absoluteFilePath from './absoluteFilePath.mjs';
import openFilePath from './openFilePath.mjs';

export default async function (payload, context) {
  const filePath = absoluteFilePath(payload?.path);
  const info = await stat(filePath);
  return openFilePath({ path: info.isDirectory() ? filePath : path.dirname(filePath) }, context);
}