export function getWindowsPanelLayout(displayBounds, taskbarBounds, panelHeight, controlWidth) {
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
  const taskbarCenterY = taskbarBounds.y + taskbarBounds.height / 2;
  const displayCenterY = displayBounds.y + displayBounds.height / 2;
  const taskbarAtTop = taskbarCenterY < displayCenterY;
  const taskbarY = taskbarAtTop
    ? displayBounds.y
    : displayBounds.y + displayBounds.height - taskbarHeight;

  return {
    topbar: {
      x: displayBounds.x,
      y: taskbarAtTop ? taskbarY + taskbarHeight : taskbarY - panelHeight,
      width: displayBounds.width,
      height: panelHeight,
    },
    controls: {
      x: displayBounds.x,
      y: taskbarY,
      width: Math.min(controlWidth, displayBounds.width),
      height: taskbarHeight,
    },
  };
}
