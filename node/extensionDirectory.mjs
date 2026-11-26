import path from 'node:path';

export default function(projectRoot, extensionId) {
  if (typeof extensionId !== 'string'
    || !extensionId
    || path.basename(extensionId) !== extensionId
    || extensionId.startsWith('.')
    || /[<>:"/\\|?*\u0000-\u001f]/.test(extensionId)) {
    throw new Error('Invalid extension id');
  }
  return path.join(projectRoot, 'extensions', extensionId);
}