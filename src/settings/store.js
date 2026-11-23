import { emit as emitTauri, listen as listenTauri } from '@tauri-apps/api/event';

const STORAGE_KEY = 'theOmniscienceSettings';
const PREVIOUS_DEFAULT_BACKGROUND = 'public/images/background.jpg';
const defaultOverviewTabs = [
  { id: 'apps-list', visible: true },
  { id: 'open-windows', visible: true },
  { id: 'settings', visible: true, locked: true },
];

function normalizeOverviewTabs(value) {
  const tabsById = new Map(defaultOverviewTabs.map((tab) => [tab.id, tab]));
  const result = [];
  const seen = new Set();

  for (const savedTab of Array.isArray(value) ? value : []) {
    if (!savedTab || typeof savedTab.id !== 'string') continue;
    const id = savedTab.id === 'web-search' ? 'open-windows' : savedTab.id;
    const definition = tabsById.get(id);
    if (!definition || seen.has(id)) continue;
    seen.add(id);
    result.push({
      ...definition,
      visible: definition.locked
        ? true
        : typeof savedTab.visible === 'boolean' ? savedTab.visible : definition.visible,
    });
  }

  for (const tab of defaultOverviewTabs) {
    if (seen.has(tab.id)) continue;
    result.push({ ...tab });
  }

  return result;
}

const defaultSettings = {
  themeEnabled: true,
  themeColors: {
    maxR: 128,
    maxG: 0,
    maxB: 128,
    targetAlpha: 0.25,
    textBrightness: 255,
  },
  background: {
    type: 'image',
    source: 'public/images/background.jpg',
    color: '#000000',
    opacity: 1,
    componentName: 'Background',
  },
  animationsEnabled: true,
  customAnimations: null,
  // Список вкладок Overview. Порядок = порядок в массиве.
  // settings — locked, его нельзя скрыть или удалить.
  overviewTabs: defaultOverviewTabs,
  desktopFiles: {
    enabled: true,
    path: null, // null → автоматически ~/Desktop из XDG
  },
};

function mergeSettings(saved = {}) {
  return {
    ...defaultSettings,
    ...saved,
    themeColors: { ...defaultSettings.themeColors, ...saved.themeColors },
    background: { ...defaultSettings.background, ...saved.background },
    desktopFiles: { ...defaultSettings.desktopFiles, ...saved.desktopFiles },
    overviewTabs: normalizeOverviewTabs(saved.overviewTabs),
  };
}

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const settings = mergeSettings(parsed);
      if (parsed.background?.source === PREVIOUS_DEFAULT_BACKGROUND) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (error) {
          console.error('[settings] background migration save failed', error);
        }
      }
      return settings;
    }
  } catch (e) {
    console.error('[settings] load failed', e);
  }
  return mergeSettings();
}

let currentSettings = loadSettings();
const listeners = new Set();

function broadcastSettings() {
  if (typeof window === 'undefined' || !window.__TAURI__) return;
  emitTauri('omniscience-settings-updated', currentSettings)
    .catch((error) => console.error('[settings] Tauri broadcast failed', error));
}

if (typeof window !== 'undefined' && window.__TAURI__) {
  listenTauri('omniscience-settings-updated', ({ payload }) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      console.error('[settings] received invalid settings from another window');
      return;
    }
    currentSettings = mergeSettings(payload);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
    } catch (error) {
      console.error('[settings] could not save settings received from another window', error);
    }
    emit();
  }).catch((error) => console.error('[settings] Tauri listener failed', error));
}

function emit() {
  for (const fn of listeners) fn();
}

export const settingsStore = {
  getState: () => currentSettings,

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  update(path, value) {
    const keys = path.split('.');
    const next = { ...currentSettings };
    let cur = next;
    for (let i = 0; i < keys.length - 1; i++) {
      cur[keys[i]] = { ...cur[keys[i]] };
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
    currentSettings = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
    } catch (e) {
      console.error('[settings] save failed', e);
    }
    emit();
    broadcastSettings();
  },

  reset() {
    currentSettings = mergeSettings();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('[settings] reset failed', error);
    }
    emit();
    broadcastSettings();
  },
};