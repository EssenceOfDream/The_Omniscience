import extractWindowsAppIcons from './extractWindowsAppIcons.mjs';
import scheduleWindowsIconExtraction from './scheduleWindowsIconExtraction.mjs';

export default async function (state, context) {
  state.flushScheduled = false;
  const queued = [...state.queued.entries()];
  state.queued.clear();
  if (queued.length === 0) return;

  let extracted = new Map();
  try {
    extracted = await extractWindowsAppIcons(
      queued.map(([key, request]) => ({ id: key, path: request.path })),
      context,
    );
  } catch (error) {
    console.error('[tauri-icons] Windows app icon extraction failed:', error.message);
  }

  for (const [key, request] of queued) {
    const result = extracted.get(key);
    if (result?.error) {
      console.warn('[tauri-icons] could not extract icon:', request.path, result.error);
    }
    const icon = result?.dataUrl || null;
    state.cache.set(key, icon);
    state.pending.delete(key);
    request.resolve(icon);
  }

  if (state.queued.size > 0) scheduleWindowsIconExtraction(state, context);
}