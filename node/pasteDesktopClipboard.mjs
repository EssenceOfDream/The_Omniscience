import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { lstat, copyFile, cp, rename, rm, stat } from 'node:fs/promises';
import absoluteDirectory from './absoluteDirectory.mjs';
import isPathInside from './isPathInside.mjs';
import getDesktopClipboard from './getDesktopClipboard.mjs';
import getWindowsNativeHost from './getWindowsNativeHost.mjs';
import { state } from './state.mjs';

export default async function (payload, context) {
  const directory = absoluteDirectory({ path: payload?.dir });
  if (!(await stat(directory)).isDirectory()) throw new Error('Paste destination is not a directory');
  const clipboard = await getDesktopClipboard(context);
  const clipboardPaths = clipboard.paths;
  const isCut = clipboard.isCut;
  if (clipboardPaths.length === 0) return { success: false, error: 'empty_clipboard', results: [] };
  const results = [];
  for (const source of clipboardPaths) {
    const destination = path.join(directory, path.basename(source));
    try {
      if (path.dirname(source) === directory) {
        throw new Error('Source and destination are the same directory');
      }
      const sourceInfo = await lstat(source);
      if (sourceInfo.isDirectory() && isPathInside(directory, source)) {
        throw new Error('A directory cannot be pasted into itself');
      }
      try {
        await lstat(destination);
        throw Object.assign(new Error('Destination already exists'), { code: 'EEXIST' });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (isCut) {
        try {
          await rename(source, destination);
        } catch (error) {
          if (error.code !== 'EXDEV') throw error;
          await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
          await rm(source, { recursive: true, force: false });
        }
      } else {
        if (sourceInfo.isDirectory()) {
          await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
        } else {
          await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
        }
      }
      results.push({ source, destination, success: true });
    } catch (error) {
      results.push({ source, destination, success: false, error: error.message });
    }
  }

  if (isCut && results.some((result) => result.success)) {
    const failedSources = new Set(results.filter((result) => !result.success).map((result) => result.source));
    state.desktopClipboardPaths = clipboardPaths.filter((source) => failedSources.has(source));
    state.desktopCutPaths = [...state.desktopClipboardPaths];
    if ((typeof context === 'string' ? null : context.platform ?? process.platform) === 'win32') {
      const nativeResult = await getWindowsNativeHost(context).request(
        state.desktopClipboardPaths.length > 0 ? 'set-file-clipboard' : 'clear-file-clipboard',
        state.desktopClipboardPaths.length > 0
          ? { paths: state.desktopClipboardPaths, isCut: true }
          : {},
      );
      if (nativeResult !== true) throw new Error('Could not update the Windows file clipboard');
    }
  }
  return {
    success: results.every((result) => result.success),
    results,
    cutPaths: [...state.desktopCutPaths],
  };
}