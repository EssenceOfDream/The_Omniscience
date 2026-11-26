import getNativeWindows from './getNativeWindows.mjs';
import mapNativeWindow from './mapNativeWindow.mjs';
import getWindowsIcons from './getWindowsIcons.mjs';

export default async function (context) {
  const windows = await getNativeWindows(context);
  const hiddenWindows = windows.filter((window) => window.taskbarHidden === true);
  const icons = await getWindowsIcons(hiddenWindows
    .filter((window) => typeof window.imagePath === 'string' && window.imagePath)
    .map((window) => ({ id: String(window.id), path: window.imagePath })), context);
  return hiddenWindows
    .map((window) => mapNativeWindow(window, icons.get(String(window.id)) || null))
    .sort((left, right) =>
      (left.processName || left.title).localeCompare(right.processName || right.title)
      || left.title.localeCompare(right.title));
}