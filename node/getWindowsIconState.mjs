import defaultWindowsIconState from './defaultWindowsIconState.mjs';

export default function (context) {
  if (typeof context === 'string') return defaultWindowsIconState;
  if (!context.windowsIconState) {
    context.windowsIconState = {
      cache: new Map(),
      pending: new Map(),
      queued: new Map(),
      flushScheduled: false,
    };
  }
  return context.windowsIconState;
}