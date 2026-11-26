import getWindowsNativeHost from './getWindowsNativeHost.mjs';

export default async function (context) {
  const nativeHost = getWindowsNativeHost(context);
  return nativeHost.request('explorer-shell-status');
}