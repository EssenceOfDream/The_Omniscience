export function clampBoundsToWorkArea(bounds, workArea) {
  const requested = {
    x: Number.isFinite(bounds?.x) ? Math.round(bounds.x) : workArea.x,
    y: Number.isFinite(bounds?.y) ? Math.round(bounds.y) : workArea.y,
    width: Number.isFinite(bounds?.width) ? Math.round(bounds.width) : 900,
    height: Number.isFinite(bounds?.height) ? Math.round(bounds.height) : 600,
  };
  const width = Math.min(Math.max(1, requested.width), workArea.width);
  const height = Math.min(Math.max(1, requested.height), workArea.height);

  return {
    x: Math.max(workArea.x, Math.min(requested.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(requested.y, workArea.y + workArea.height - height)),
    width,
    height,
  };
}
