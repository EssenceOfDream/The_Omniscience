const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron_network_API', {
  // Wi-Fi
  scanWifi: () => ipcRenderer.invoke('wifi:scan'),
  connectWifi: (ssid, password) => ipcRenderer.invoke('wifi:connect', { ssid, password }),
  disconnectWifi: () => ipcRenderer.invoke('wifi:disconnect'),
  getWifiStatus: () => ipcRenderer.invoke('wifi:status'),
  startHotspot: (ssid, password) => ipcRenderer.invoke('wifi:start-hotspot', { ssid, password }),
  stopHotspot: () => ipcRenderer.invoke('wifi:stop-hotspot'),

  // Bluetooth
  startBluetoothScan: () => ipcRenderer.invoke('bluetooth:start-scan'),
  connectBluetooth: (address) => ipcRenderer.invoke('bluetooth:connect', { address }),
  disconnectBluetooth: () => ipcRenderer.invoke('bluetooth:disconnect'),

  // Подписка на события Bluetooth
  onBluetoothDeviceFound: (callback) => {
    const listener = (_event, device) => callback(device);
    ipcRenderer.on('bluetooth:device-found', listener);
    return () => ipcRenderer.removeListener('bluetooth:device-found', listener);
  },
  onBluetoothScanFinished: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('bluetooth:scan-finished', listener);
    return () => ipcRenderer.removeListener('bluetooth:scan-finished', listener);
  },
});