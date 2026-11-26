import { startWindowsNativeHost } from './windows-native-host.mjs';

export default function (context) {
  if (typeof context === 'string') {
    throw new Error('Windows hidden-window support is unavailable in this request context');
  }
  if ((context.platform ?? process.platform) !== 'win32') {
    throw new Error('The hidden-windows panel is only supported on Windows');
  }
  if (!context.nativeWindowHost) {
    context.nativeWindowHost = startWindowsNativeHost(context.projectRoot);
  }
  return context.nativeWindowHost;
}