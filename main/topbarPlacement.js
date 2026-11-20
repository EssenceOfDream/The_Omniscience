export function forceWindowPlacementAboveTaskbar(window, bounds) {
  if (!window || window.isDestroyed()) return false;

  window.setBounds(bounds, false);
  const actualBounds = window.getBounds();
  if (actualBounds.x !== bounds.x || actualBounds.y !== bounds.y
    || actualBounds.width !== bounds.width || actualBounds.height !== bounds.height) {
    throw new Error(
      `window bounds did not apply (expected ${JSON.stringify(bounds)}, got ${JSON.stringify(actualBounds)})`,
    );
  }

  if (!window.isAlwaysOnTop()) window.setAlwaysOnTop(true, 'screen-saver');
  window.moveTop();
  if (!window.isAlwaysOnTop()) {
    window.setAlwaysOnTop(true, 'screen-saver');
    if (!window.isAlwaysOnTop()) {
      throw new Error('window is not always-on-top after forcing its z-order');
    }
  }

  return true;
}
