export function mapNativeWindowForTopbar(window, normalizedId, activeId) {
  const pid = Number(window.pid) || null;
  const imageName = window.imagePath?.split(/[\\/]/).pop() || '';
  const processName = imageName.replace(/\.[^.]+$/, '') || null;
  return {
    id: window.id,
    xid: normalizedId,
    kind: 'native',
    title: window.title || window.wmClass || 'Окно',
    processName,
    icon: window.icon || null,
    maximized: !!window.isMaximized,
    minimized: !!window.isMinimized,
    isHidden: false,
    visible: window.visible,
    taskbarHidden: window.taskbarHidden === true,
    focused: !!(activeId && normalizedId === activeId),
    wmClass: window.wmClass,
    x: window.x, y: window.y, width: window.width, height: window.height,
    isBridgeOverlay: false, daemonWindowId: null, gtkXid: null,
    isDevTools: false, ownerId: null,
    pid, parentXid: null,
    overlayWindowId: null,
  };
}

export function selectTaskbarHiddenWindows(windows) {
  return windows
    .filter((window) => window.taskbarHidden)
    .map((window) => ({ ...window, isHidden: true }));
}
