import getWindowsNativeHost from './getWindowsNativeHost.mjs';
import listNativeWindows from './listNativeWindows.mjs';

export default async function (payload, context) {
  const { id, mode, direction } = payload ?? {};
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) {
    throw new Error('A valid native-window id is required');
  }
  if (mode !== 'move' && mode !== 'resize') {
    throw new Error('Unsupported native-window drag mode');
  }
  const resizeDirections = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
  if (mode === 'resize' && !resizeDirections.includes(direction)) {
    throw new Error('Unsupported native-window resize direction');
  }

  const windows = await listNativeWindows(context);
  if (!windows.some((window) => window.id === id)) {
    return { ok: false, abort: true };
  }

  const nativeHost = getWindowsNativeHost(context);
  const result = await nativeHost.request('prepare-drag', {
    hwnd: id,
    mode,
    direction: direction ?? '',
  });
  if (!result) return { ok: false, abort: true };
  return {
    ok: true,
    bounds: {
      x: result.x,
      y: result.y,
      width: result.width,
      height: result.height,
    },
    cursor: { x: result.cursorX, y: result.cursorY },
    nativeDrag: Boolean(result.nativeDrag),
  };
}