import getWindowsNativeHost from './getWindowsNativeHost.mjs';
import listHiddenWindows from './listHiddenWindows.mjs';

export default async function (payload, context) {
  const id = payload?.id;
  const action = payload?.action;
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) {
    throw new Error('A valid hidden-window id is required');
  }
  if (!['focus', 'minimize', 'maximize', 'close'].includes(action)) {
    throw new Error('Unsupported hidden-window action');
  }

  const nativeHost = getWindowsNativeHost(context);
  const windows = await listHiddenWindows(context);
  const target = windows.find((window) => window.id === id);
  if (!target) throw new Error('The hidden window is no longer available');

  const result = await nativeHost.request(action, {
    hwnd: id,
    ...(action === 'maximize' ? { maximize: !target.maximized } : {}),
  });
  if (result !== true) throw new Error(`Could not ${action} hidden window ${id}`);
  return { success: true };
}