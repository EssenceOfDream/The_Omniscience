import flushWindowsIconQueue from './flushWindowsIconQueue.mjs';

export default function (state, context) {
  if (state.flushScheduled) return;
  state.flushScheduled = true;
  setTimeout(() => void flushWindowsIconQueue(state, context), 10);
}