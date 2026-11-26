import path from 'node:path';

export function absoluteFilePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('An absolute file path is required');
  }
  return path.resolve(value);
}