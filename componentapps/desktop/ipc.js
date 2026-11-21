import electronPkg from 'electron';
const { ipcMain, BrowserWindow } = electronPkg;

let resizeState = null;

function sendWindowState(win) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('window-state-changed', {
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen(),
    });
  }
}

export default function () {
  global.mainWindow.on('maximize', () => sendWindowState(global.mainWindow));
  global.mainWindow.on('unmaximize', () => sendWindowState(global.mainWindow));
  global.mainWindow.on('enter-full-screen', () => sendWindowState(global.mainWindow));
  global.mainWindow.on('leave-full-screen', () => sendWindowState(global.mainWindow));

  ipcMain.on('start-resize', (event, direction) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win !== global.mainWindow || win.isMaximized() || win.isFullScreen()) return;
    const bounds = win.getBounds();
    resizeState = {
      win,
      direction,
      startBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      startMouse: null,
      minWidth: 400,
      minHeight: 300,
    };
  });

  ipcMain.on('resize-move', (event, screenX, screenY) => {
    if (!resizeState) return;
    const { win, direction, startBounds, minWidth, minHeight } = resizeState;
    if (!resizeState.startMouse) {
      resizeState.startMouse = { x: screenX, y: screenY };
      return;
    }
    const dx = screenX - resizeState.startMouse.x;
    const dy = screenY - resizeState.startMouse.y;
    const bounds = {
      x: startBounds.x,
      y: startBounds.y,
      width: startBounds.width,
      height: startBounds.height,
    };
    if (direction.includes('right')) bounds.width = Math.max(minWidth, startBounds.width + dx);
    if (direction.includes('left')) {
      bounds.width = Math.max(minWidth, startBounds.width - dx);
      bounds.x = startBounds.x + startBounds.width - bounds.width;
    }
    if (direction.includes('bottom')) bounds.height = Math.max(minHeight, startBounds.height + dy);
    if (direction.includes('top')) {
      bounds.height = Math.max(minHeight, startBounds.height - dy);
      bounds.y = startBounds.y + startBounds.height - bounds.height;
    }
    win.setBounds(bounds);
  });

  ipcMain.on('resize-end', () => {
    resizeState = null;
  });

  ipcMain.on('window_minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on('window_maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('window_close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}
