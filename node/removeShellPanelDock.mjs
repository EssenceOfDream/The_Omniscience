import getWindowsNativeHost from './getWindowsNativeHost.mjs';

export default async function (payload, context) {
  const hwnd = payload?.hwnd;
  if (typeof hwnd !== 'string' || !/^[1-9]\d*$/.test(hwnd)) {
    throw new Error('A valid shell panel handle is required');
  }
  const result = await getWindowsNativeHost(context).request('dock-remove', { hwnd });
  if (result !== true) throw new Error('Could not release the shell panel work area');
  return true;
}