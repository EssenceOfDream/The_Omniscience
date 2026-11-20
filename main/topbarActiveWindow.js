export function resolveActiveWindow(windows, lastFocusedWindowId) {
  if (!Array.isArray(windows) || windows.length === 0) return null;

  const focusedWindow = windows.find((window) => window.focused);
  if (focusedWindow) return focusedWindow;

  const lastFocusedWindow = windows.find((window) => window.id === lastFocusedWindowId);
  return lastFocusedWindow || windows[0];
}
