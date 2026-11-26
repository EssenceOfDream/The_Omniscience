import getWindowsNativeHost from './getWindowsNativeHost.mjs';

export default async function (payload, context) {
  const hwnd = payload?.hwnd;
  const layer = payload?.layer;
  if (typeof hwnd !== 'string' || !/^[1-9]\d*$/.test(hwnd)) {
    throw new Error('A valid shell window handle is required');
  }
  if (layer !== 'desktop' && layer !== 'top') {
    throw new Error('Unsupported shell window layer');
  }

  const nativeHost = getWindowsNativeHost(context);
  const action = layer === 'desktop' ? 'desktop-bottom' : 'z-order';
  const result = await nativeHost.request(action, {
    hwnd,
    ...(layer === 'top' ? { layer } : {}),
  });
  if (result !== true) throw new Error(`Could not place shell window in the ${layer} layer`);
  return true;
}