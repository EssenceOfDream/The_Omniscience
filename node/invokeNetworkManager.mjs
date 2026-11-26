import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import wifi from 'node-wifi';
import {getDisplaySsid} from '../componentapps/NetworkManager/wifi-encoding.js';

const execFileAsync = promisify(execFile);
let wifiInitialized = false;

export default async function (channel, args, context) {
  const failure = (error) => ({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });
  const wifiAdapter = typeof context === 'object' && context?.wifi
    ? context.wifi
    : wifi;
  try {
    if (channel.startsWith('wifi:') && wifiAdapter === wifi && !wifiInitialized) {
      wifiAdapter.init({ iface: null });
      wifiInitialized = true;
    }
    if (channel === 'wifi:scan') {
      const networks = await wifiAdapter.scan();
      return {
        success: true,
        data: networks.map((network) => ({
          ...network,
          displaySsid: getDisplaySsid(network.ssid || ''),
        })),
      };
    }
    if (channel === 'wifi:connect') {
      const [ssid, password = ''] = args;
      if (typeof ssid !== 'string' || !ssid.trim()) return failure(new Error('Не указано имя Wi-Fi сети'));
      await wifiAdapter.connect({ ssid, password });
      return { success: true };
    }
    if (channel === 'wifi:disconnect') {
      await wifiAdapter.disconnect();
      return { success: true };
    }
    if (channel === 'wifi:status') {
      const connections = await wifiAdapter.getCurrentConnections();
      return { success: true, data: connections[0] || null };
    }
    if (channel === 'wifi:start-hotspot') {
      const [ssid, password] = args;
      if (process.platform !== 'win32') return failure(new Error('Точка доступа поддерживается только в Windows'));
      if (typeof ssid !== 'string' || !ssid.trim() || ssid.length > 32) {
        return failure(new Error('Имя точки доступа должно содержать от 1 до 32 символов'));
      }
      if (typeof password !== 'string' || password.length < 8 || password.length > 63) {
        return failure(new Error('Пароль точки доступа должен содержать от 8 до 63 символов'));
      }
      await execFileAsync('netsh.exe', [
        'wlan', 'set', 'hostednetwork', 'mode=allow', `ssid=${ssid}`, `key=${password}`,
      ], { windowsHide: true });
      await execFileAsync('netsh.exe', ['wlan', 'start', 'hostednetwork'], { windowsHide: true });
      return { success: true };
    }
    if (channel === 'wifi:stop-hotspot') {
      if (process.platform !== 'win32') return failure(new Error('Точка доступа поддерживается только в Windows'));
      await execFileAsync('netsh.exe', ['wlan', 'stop', 'hostednetwork'], { windowsHide: true });
      return { success: true };
    }
    if (channel.startsWith('bluetooth:')) {
      return failure(new Error('Управление Bluetooth-устройствами пока не поддерживается в Tauri'));
    }
  } catch (error) {
    return failure(error);
  }
  throw new Error(`Unsupported NetworkManager channel ${channel}`);
}