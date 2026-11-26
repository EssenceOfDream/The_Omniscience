import getWindowsNativeHost from './getWindowsNativeHost.mjs';
import listNativeWindows from './listNativeWindows.mjs';

export default async function (payload, context) {
  const id = payload?.id;
  const action = payload?.action;
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) {
    throw new Error('A valid native-window id is required');
  }
  if (!['focus', 'minimize', 'maximize', 'close'].includes(action)) {
    throw new Error('Unsupported native-window action');
  }

  const nativeHost = getWindowsNativeHost(context);
  const windows = await listNativeWindows(context);
  const target = windows.find((window) => window.id === id);
  if (!target) throw new Error('The native window is no longer available');

  const result = await nativeHost.request(action, {
    hwnd: id,
    ...(action === 'maximize' ? { maximize: !target.maximized } : {}),
  });
  if (result !== true) throw new Error(`Could not ${action} native window ${id}`);
  return { success: true };
}