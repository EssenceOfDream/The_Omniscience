export function getOverviewBounds(displayBounds, topbarBounds) {
  const top = topbarBounds.y + topbarBounds.height;
  const bottom = displayBounds.y + displayBounds.height;

  return {
    x: displayBounds.x,
    y: top,
    width: displayBounds.width,
    height: Math.max(0, bottom - top),
  };
}
