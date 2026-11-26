import getWindowsIconState from './getWindowsIconState.mjs';
import scheduleWindowsIconExtraction from './scheduleWindowsIconExtraction.mjs';

export default async function (requests, context = {}) {
  const state = getWindowsIconState(context);
  const icons = await Promise.all(requests.map((request) => {
    const key = request.path.toLowerCase();
    if (state.cache.has(key)) return state.cache.get(key);
    if (state.pending.has(key)) return state.pending.get(key);

    let resolve;
    const pending = new Promise((complete) => {
      resolve = complete;
    });
    state.pending.set(key, pending);
    state.queued.set(key, { ...request, resolve });
    scheduleWindowsIconExtraction(state, context);
    return pending;
  }));
  return new Map(requests.map((request, index) => [request.id, icons[index] || null]));
}