import path from 'node:path';

export default function (payload) {
  const requestedPath = payload?.path;
  if (typeof requestedPath !== 'string' || !path.isAbsolute(requestedPath)) {
    throw new Error('An absolute directory path is required');
  }
  return path.resolve(requestedPath);
}