import getWindowsNativeHost from './getWindowsNativeHost.mjs';
import validateExistingPaths from './validateExistingPaths.mjs';
import { state } from './state.mjs';

export default async function (payload, mode, context) {
  const paths = await validateExistingPaths(payload?.paths);
  const platform = typeof context === 'string' ? null : context.platform ?? process.platform;
  if (platform === 'win32') {
    const result = await getWindowsNativeHost(context).request('set-file-clipboard', {
      paths,
      isCut: mode === 'cut',
    });
    if (result !== true) throw new Error('Could not copy file paths to the Windows clipboard');
  }
  state.desktopClipboardPaths = paths;
  state.desktopCutPaths = mode === 'cut' ? paths : [];
  return { success: true, count: paths.length, cutPaths: [...state.desktopCutPaths] };
}