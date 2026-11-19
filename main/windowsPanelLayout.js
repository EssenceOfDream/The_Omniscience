const CONTROL_WINDOW_BOTTOM_PADDING = 3;

export function getWindowsPanelLayout(
  displayBounds, taskbarBounds, panelHeight, controlWidth,
) {
  const values = [
    displayBounds?.x, displayBounds?.y, displayBounds?.width, displayBounds?.height,
    taskbarBounds?.x, taskbarBounds?.y, taskbarBounds?.width, taskbarBounds?.height,
    panelHeight, controlWidth,
  ];
  if (!values.every(Number.isFinite)
    || displayBounds.width <= 0 || displayBounds.height <= 0
    || taskbarBounds.width <= 0 || taskbarBounds.height <= 0
    || panelHeight <= 0 || controlWidth <= 0) {
    throw new Error('Invalid display or taskbar bounds');
  }

  const taskbarHeight = Math.min(taskbarBounds.height, displayBounds.height);

  return {
    topbar: {
      x: displayBounds.x + Math.min(controlWidth, displayBounds.width),
      y: displayBounds.y + taskbarHeight,
      width: Math.max(1, displayBounds.width - controlWidth),
      height: panelHeight,
    },
    controls: {
      x: displayBounds.x,
      y: displayBounds.y,
      width: Math.min(controlWidth, displayBounds.width),
      height: taskbarHeight + panelHeight + CONTROL_WINDOW_BOTTOM_PADDING,
    },
  };
}
