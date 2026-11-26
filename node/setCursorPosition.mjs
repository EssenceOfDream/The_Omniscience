import getWindowsNativeHost from './getWindowsNativeHost.mjs';

export default async function (payload, context) {
  const { x, y } = payload ?? {};
  const isInt32 = (value) => Number.isInteger(value)
    && value >= -2147483648 && value <= 2147483647;
  if (!isInt32(x) || !isInt32(y)) {
    throw new Error('Cursor coordinates must be valid 32-bit integers');
  }
  const nativeHost = getWindowsNativeHost(context);
  const result = await nativeHost.request('cursor', { x, y });
  if (result !== true) throw new Error('Could not move the cursor');
  return { ok: true };
}