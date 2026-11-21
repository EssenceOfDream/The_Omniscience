const { contextBridge, ipcRenderer, webUtils } = require('electron');

function on(channel, listener) {
  const wrapped = (_event, ...args) => listener(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('electron_desktop_API', {
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('get-config'),
  getAppsList: () => ipcRenderer.invoke('get-apps-list'),
  registerWebview: (webContentsId, appId, windowId) =>
    ipcRenderer.invoke('register-webview', { webContentsId, appId, windowId }),
  getWebviewPreloadPath: () => ipcRenderer.invoke('get-webview-preload-path'),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on,
  removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
  getDesktopViewBounds: () => ipcRenderer.invoke('get-desktop-view-bounds'),
  goBack: (windowId) => ipcRenderer.send('window-go-back', windowId),
  goForward: (windowId) => ipcRenderer.send('window-go-forward', windowId),
  reload: (windowId) => ipcRenderer.send('window-reload', windowId),
  loadUrl: (windowId, url) => ipcRenderer.send('window-load-url', windowId, url),
  stopLoad: (windowId) => ipcRenderer.send('window-stop-load', windowId),
  getWindowNavState: (windowId) => ipcRenderer.invoke('get-window-nav-state', windowId),
  onWindowNavigationUpdate: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on('window-navigation-update', wrapped);
    return () => ipcRenderer.removeListener('window-navigation-update', wrapped);
  },
  setWebViewBounds: (id, bounds) => ipcRenderer.send('set-webview-bounds', { id, bounds }),
  onRequestWebViewBounds: (callback) =>
    ipcRenderer.on('request-webview-bounds', (_event, id) => callback(id)),
  createView: (options) => ipcRenderer.send('view:create', options),
  updateViewBounds: (options) => ipcRenderer.send('view:update-bounds', options),
  destroyView: (options) => ipcRenderer.send('view:destroy', options),
  setViewZ: (options) => ipcRenderer.send('view:set-z', options),
  getViewBounds: (id) => ipcRenderer.invoke('view:get-bounds', { id }),
  getProjectRoot: () => ipcRenderer.invoke('get-project-root'),
  getUserDirs: () => ipcRenderer.invoke('fs:get-user-dirs'),
  readDir: (path, desktopRoot) => ipcRenderer.invoke('fs:read-dir', { path, desktopRoot }),
  getFileInfo: (path) => ipcRenderer.invoke('fs:get-info', { path }),
  getFileIcon: (path) => ipcRenderer.invoke('fs:get-icon', { path }),
  openPath: (path) => ipcRenderer.invoke('fs:open', { path }),
  revealPath: (path) => ipcRenderer.invoke('fs:reveal', { path }),
  trashPath: (path) => ipcRenderer.invoke('fs:trash', { path }),
  deletePath: (path) => ipcRenderer.invoke('fs:delete', { path }),
  renamePath: (path, newName) => ipcRenderer.invoke('fs:rename', { path, newName }),
  getAppsForFile: (path) => ipcRenderer.invoke('fs:get-apps-for-file', { path }),
  openWith: (path, desktopId) => ipcRenderer.invoke('fs:open-with', { path, desktopId }),
  watchStart: (path) => ipcRenderer.send('fs:watch-start', { path }),
  watchStop: (path) => ipcRenderer.send('fs:watch-stop', { path }),
  getTemplates: () => ipcRenderer.invoke('fs:get-templates'),
  createFolder: (dir, name) => ipcRenderer.invoke('fs:create-folder', { dir, name }),
  createFile: (dir, name) => ipcRenderer.invoke('fs:create-file', { dir, name }),
  createFromTemplate: (dir, templatePath, name) =>
    ipcRenderer.invoke('fs:create-from-template', { dir, templatePath, name }),
  openKRunner: () => ipcRenderer.invoke('shell:run-krunner'),
  openSystemSettings: () => ipcRenderer.invoke('shell:systemsettings'),
  openLogout: () => ipcRenderer.invoke('shell:logout'),
  setContextPaths: (payload) => ipcRenderer.send('fs:context-paths', payload),
  copyFiles: (paths) => ipcRenderer.invoke('fs:copy', { paths }),
  cutFiles: (paths) => ipcRenderer.invoke('fs:cut', { paths }),
  pasteFiles: (dir) => ipcRenderer.invoke('fs:paste', { dir }),
  getCutPaths: () => ipcRenderer.invoke('fs:get-cut'),
  clearCut: () => ipcRenderer.invoke('fs:clear-cut'),
  startDrag: (paths) => ipcRenderer.send('fs:start-drag', { paths }),
  dropPaths: (srcPaths, destDir, isMove) =>
    ipcRenderer.invoke('fs:drop-paths', { srcPaths, destDir, isMove }),
  getPathForFile: (file) => {
    try {
      if (webUtils?.getPathForFile) return webUtils.getPathForFile(file);
    } catch { /* fallback */ }
    return file?.path || null;
  },
  writeDroppedFiles: (files, destDir) =>
    ipcRenderer.invoke('fs:write-dropped-files', { files, destDir }),
  enableKeyboardCapture: () => ipcRenderer.send('fs:enable-keyboard-capture'),
  disableKeyboardCapture: () => ipcRenderer.send('fs:disable-keyboard-capture'),
  getNativeState: () => ipcRenderer.invoke('native-windows:get-state'),
});

contextBridge.exposeInMainWorld('electron_mainWindow_API', {
  onWindowStateChange: (callback) => on('window-state-changed', callback),
  startResize: (direction) => ipcRenderer.send('start-resize', direction),
  sendResizeMove: (screenX, screenY) => ipcRenderer.send('resize-move', screenX, screenY),
  endResize: () => ipcRenderer.send('resize-end'),
  window_minimize: () => ipcRenderer.send('window_minimize'),
  window_maximize: () => ipcRenderer.send('window_maximize'),
  window_close: () => ipcRenderer.send('window_close'),
});

contextBridge.exposeInMainWorld('electron_view_API', {
  dispatch: (type, payload) => ipcRenderer.send('view:dispatch', { type, payload }),
  subscribe: (paths) => ipcRenderer.send('view:subscribe', {
    paths: Array.isArray(paths) ? paths : [paths],
  }),
  unsubscribe: (paths) => ipcRenderer.send('view:unsubscribe', {
    paths: Array.isArray(paths) ? paths : [paths],
  }),
  onStateUpdate: (callback) => on('view:state-update', callback),
  getAppsList: () => ipcRenderer.invoke('get-apps-list'),
  getProjectRoot: () => ipcRenderer.invoke('get-project-root'),
});
