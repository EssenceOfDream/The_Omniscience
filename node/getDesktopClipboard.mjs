import getWindowsNativeHost from './getWindowsNativeHost.mjs';
import { state } from './state.mjs';

export default async function (context) {
  const platform = typeof context === 'string' ? null : context.platform ?? process.platform;
  if (platform === 'win32') {
    const clipboard = await getWindowsNativeHost(context).request('get-file-clipboard');
    if (clipboard && Array.isArray(clipboard.paths)) {
      state.desktopClipboardPaths = clipboard.paths.filter((value) => typeof value === 'string');
      state.desktopCutPaths = clipboard.isCut ? [...state.desktopClipboardPaths] : [];
    }
  }
  return { paths: [...state.desktopClipboardPaths], isCut: state.desktopCutPaths.length > 0 };
}