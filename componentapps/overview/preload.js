const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron_overview_API', {
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, listener) => {
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});

contextBridge.exposeInMainWorld('electron_desktop_API', {
  createView: (options) => ipcRenderer.send('view:create', options),
  updateViewBounds: (options) => ipcRenderer.send('view:update-bounds', options),
  destroyView: (options) => ipcRenderer.send('view:destroy', options),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
