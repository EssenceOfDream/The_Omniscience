import listDirectory from './listDirectory.mjs';
// ⚠️ В исходнике mediaKind не объявлен. Подставь правильный путь.
import mediaKind from './mediaKind.mjs';

export default async function (payload) {
  try {
    const listing = await listDirectory({ path: payload?.path });
    return {
      success: true,
      files: listing.entries.map((entry) => ({
        id: entry.path,
        name: entry.name,
        displayName: entry.name,
        isDir: entry.kind === 'directory',
        mediaKind: entry.kind === 'file' ? mediaKind(entry.name) : null,
        fileUrl: null,
        iconPath: null,
        infoTip: null,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
      })),
      directoryMetadata: null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.code === 'EACCES' || error.code === 'EPERM'
        ? 'permission_denied'
        : error.message,
    };
  }
}