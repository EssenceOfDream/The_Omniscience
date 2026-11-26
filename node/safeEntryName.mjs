import path from 'node:path';

export default function (value) {
  if (typeof value !== 'string') throw new Error('A name is required');
  const name = value.trim();
  if (!name || name === '.' || name === '..'
    || path.basename(name) !== name
    || /[<>:"/\\|?*\u0000-\u001f]/.test(name)) {
    throw new Error('Invalid file or folder name');
  }
  return name;
}