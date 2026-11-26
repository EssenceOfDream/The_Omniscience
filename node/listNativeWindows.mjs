import getNativeWindows from './getNativeWindows.mjs';
import mapNativeWindow from './mapNativeWindow.mjs';
import getWindowsIcons from './getWindowsIcons.mjs';

export default async function (context) {
  const windows = await getNativeWindows(context);
  const visibleWindows = windows
    .filter((window) => window.visible === true && window.taskbarHidden !== true);
  const icons = await getWindowsIcons(visibleWindows
    .filter((window) => typeof window.imagePath === 'string' && window.imagePath)
    .map((window) => ({ id: String(window.id), path: window.imagePath })), context);
  return visibleWindows
    .map((window) => ({
      ...mapNativeWindow(window, icons.get(String(window.id)) || null),
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
    }))
    .sort((left, right) =>
      Number(right.focused) - Number(left.focused)
      || (left.processName || left.title).localeCompare(right.processName || right.title)
      || left.title.localeCompare(right.title));
}