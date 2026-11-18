const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron_windowsSettings_API', {
  openCategory: (category) => ipcRenderer.invoke('windows-settings:open-category', category),
});
