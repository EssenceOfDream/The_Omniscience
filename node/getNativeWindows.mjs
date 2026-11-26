import getWindowsNativeHost from './getWindowsNativeHost.mjs';

export default async function (context) {
  const nativeHost = getWindowsNativeHost(context);
  const result = await nativeHost.request('list', {
    ownPid: context.nativeWindowOwnPid ?? process.pid,
  });
  return Array.isArray(result) ? result : result ? [result] : [];
}