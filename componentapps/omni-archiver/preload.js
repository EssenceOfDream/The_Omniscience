const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electron_omniArchiver_API', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  selectOutputDir: () => ipcRenderer.invoke('omni-archiver:select-output-dir'),
  selectFolders: () => ipcRenderer.invoke('omni-archiver:select-folders'),
  resolveOutputPath: (p) => ipcRenderer.invoke('omni-archiver:resolve-output-path', p),
  readClipboard: () => ipcRenderer.invoke('omni-archiver:read-clipboard'),
  saveTextToTemp: (text) => ipcRenderer.invoke('omni-archiver:save-text-to-temp', text),
  enumerate: (paths) => ipcRenderer.invoke('omni-archiver:enumerate', paths),
  start: (options) => ipcRenderer.invoke('omni-archiver:start', options),
  cancel: () => ipcRenderer.invoke('omni-archiver:cancel'),
  onProgress: (cb) => {
    const listener = (_e, d) => cb(d);
    ipcRenderer.on('omni-archiver:progress', listener);
    return () => ipcRenderer.removeListener('omni-archiver:progress', listener);
  },
  selectSaveVhd: () => ipcRenderer.invoke('omni-archiver:select-save-vhd'),
  unpackFragments: (opts) => ipcRenderer.invoke('omni-archiver:unpack-fragments', opts),
  unpackVhd: (opts) => ipcRenderer.invoke('omni-archiver:unpack-vhd', opts),
});