const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omniscienceHostAPI', {
  getStatus: () => ipcRenderer.invoke('host:get-status'),
  apply: () => ipcRenderer.invoke('host:apply'),
  reload: () => ipcRenderer.invoke('host:reload-renderers'),
  restart: () => ipcRenderer.invoke('host:restart'),
  openProject: () => ipcRenderer.invoke('host:open-project'),
});
