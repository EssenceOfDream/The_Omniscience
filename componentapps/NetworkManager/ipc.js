// componentapps/NetworkManager/ipc.js
import electronPkg from 'electron';
const { ipcMain } = electronPkg;
import wifi from 'node-wifi';
import bluetoothPkg from 'bluetooth-serial-port';
import { getDisplaySsid } from './wifi-encoding.js';

wifi.init({ iface: null });
const btDevice = new bluetoothPkg.BluetoothSerialPort();
let btScanning = false;
let scanSender = null;

btDevice.on('found', (address, name) => {
  if (scanSender && !scanSender.isDestroyed()) {
    scanSender.send('bluetooth:device-found', {
      id: address,
      address,
      name: name || 'Неизвестное устройство',
    });
  }
});

btDevice.on('finished', () => {
  btScanning = false;
  if (scanSender && !scanSender.isDestroyed()) {
    scanSender.send('bluetooth:scan-finished');
  }
  scanSender = null;
});

export default function () {
  // ==================== Wi-Fi ====================
  ipcMain.handle('wifi:scan', async () => {
    try {
      const networks = await wifi.scan();
      return {
        success: true,
        data: networks.map((network) => ({
          ...network,
          displaySsid: getDisplaySsid(network.ssid || ''),
        })),
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('wifi:connect', async (_event, { ssid, password }) => {
    try {
      await wifi.connect({ ssid, password });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('wifi:disconnect', async () => {
    try {
      await wifi.disconnect();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('wifi:start-hotspot', async (_event, { ssid, password }) => {
    try {
      if (process.platform === 'win32') {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        await execAsync(`netsh wlan set hostednetwork mode=allow ssid=${ssid} key=${password}`);
        await execAsync(`netsh wlan start hostednetwork`);
        return { success: true };
      }
      return { success: false, error: 'Только для Windows' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('wifi:stop-hotspot', async () => {
    try {
      if (process.platform === 'win32') {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        await execAsync(`netsh wlan stop hostednetwork`);
        return { success: true };
      }
      return { success: false, error: 'Только для Windows' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ==================== Bluetooth Classic ====================
  ipcMain.handle('bluetooth:start-scan', async (event) => {
    if (btScanning) {
      return { success: false, error: 'Сканирование уже запущено' };
    }
    btScanning = true;
    scanSender = event.sender;

    try {
      btDevice.inquire();
      return { success: true };
    } catch (err) {
      btScanning = false;
      scanSender = null;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('bluetooth:connect', async (_event, { address }) => {
    if (!address) {
      return { success: false, error: 'Не указан адрес Bluetooth-устройства' };
    }

    return new Promise((resolve) => {
      btDevice.findSerialPortChannel(address, (channel) => {
        btDevice.connect(address, channel, () => {
          resolve({ success: true, channel });
        }, (err) => {
          resolve({ success: false, error: err?.message || 'Не удалось подключиться к устройству' });
        });
      }, () => {
        resolve({ success: false, error: 'Устройство не предоставляет профиль последовательного порта' });
      });
    });
  });

  ipcMain.handle('bluetooth:disconnect', async () => {
    try {
      if (btDevice.isOpen()) {
        btDevice.close();
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}