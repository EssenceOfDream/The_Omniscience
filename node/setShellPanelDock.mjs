import getWindowsNativeHost from './getWindowsNativeHost.mjs';

export default async function (payload, context) {
  const { hwnd, x, y, width, height } = payload ?? {};
  if (typeof hwnd !== 'string' || !/^[1-9]\d*$/.test(hwnd)) {
    throw new Error('A valid shell panel handle is required');
  }
  if (![x, y, width, height].every(Number.isSafeInteger)
    || width <= 0 || height <= 0) {
    throw new Error('Valid shell panel bounds are required');
  }

  const result = await getWindowsNativeHost(context).request('dock', {
    hwnd,
    x,
    y,
    width,
    height,
    edge: 'top',
  });
  if (result !== true) throw new Error('Could not reserve the shell panel work area');
  return true;
}