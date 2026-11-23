import { invoke, listen, nodeRequest, type ProgramWindow } from './tauri';

type ManagedWindow = ProgramWindow & {
  id: string;
  kind: 'our' | 'native';
  processName: string;
  isHidden?: boolean;
  icon?: string | null;
};

type HiddenWindow = {
  id: string;
  title: string;
  processName: string | null;
  minimized: boolean;
  maximized: boolean;
  focused: boolean;
};

type TopbarState = {
  windows: ManagedWindow[];
  hiddenWindows: ManagedWindow[];
  activeWindow: ManagedWindow | null;
  apps: unknown[];
  overviewTabs: unknown[];
  showWindowList: boolean;
  showClock: boolean;
  showClockMs: boolean;
  isWindowsPanel: boolean;
  overviewOpen: boolean;
  developmentStatus: null;
};

type TopbarApi = {
  invoke: (channel: string, payload?: Record<string, unknown>) => Promise<unknown>;
  send: (channel: string, payload?: Record<string, unknown>) => void;
  on: (channel: string, callback: (state: TopbarState) => void) => () => void;
  platform: string;
};

declare global {
  interface Window {
    electron_topbar_API?: TopbarApi;
  }
}

const stateListeners = new Set<(state: TopbarState) => void>();
let platform = '';
let lastState: TopbarState | null = null;
let refreshInProgress = false;

async function getTopbarState(): Promise<TopbarState> {
  const [health, appWindows, baseApps, nativeApps] = await Promise.all([
    nodeRequest<{ platform: string }>('health'),
    invoke<ProgramWindow[]>('list_program_windows'),
    nodeRequest<Array<{ id: string; type: string; title: string; url: string | null; icon: string | null; launchable: boolean }>>('get-apps-list'),
    nodeRequest<Array<{ id: string; name: string; category: string; launchable: boolean; launchType?: string }>>('list-native-apps'),
  ]);
  platform = health.platform;
  if (window.electron_topbar_API) window.electron_topbar_API.platform = platform;
  const windows: ManagedWindow[] = appWindows.map((item) => ({
    ...item,
    id: item.label,
    kind: 'our',
    processName: item.title,
    icon: null,
  }));
  const nativeWindows = platform === 'win32'
    ? await nodeRequest<HiddenWindow[]>('list-hidden-windows')
    : [];
  const hiddenWindows: ManagedWindow[] = nativeWindows.map((item) => ({
    id: item.id,
    label: item.id,
    kind: 'native',
    title: item.title,
    processName: item.processName || item.title,
    minimized: item.minimized,
    maximized: item.maximized,
    focused: item.focused,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    isHidden: true,
    icon: null,
  }));

  return {
    windows,
    hiddenWindows,
    activeWindow: [...windows, ...hiddenWindows].find((item) => item.focused)
      || windows.find((item) => !item.minimized)
      || hiddenWindows[0]
      || null,
    apps: [
      ...baseApps.map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        url: item.url,
        icon: item.icon,
        launchable: item.launchable,
      })),
      ...nativeApps.map((item) => ({
        id: item.id,
        title: item.name,
        type: 'native',
        kind: 'native',
        launchType: item.launchType,
        launchable: item.launchable,
      })),
    ],
    overviewTabs: [
      { id: 'apps-list', visible: true },
      { id: 'open-windows', visible: true },
      { id: 'settings', visible: true, locked: true },
    ],
    showWindowList: true,
    showClock: true,
    showClockMs: false,
    isWindowsPanel: platform === 'win32',
    overviewOpen: false,
    developmentStatus: null,
  };
}

async function publishState() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try {
    lastState = await getTopbarState();
    for (const listener of stateListeners) listener(lastState);
  } catch (error) {
    console.error('[tauri-topbar] could not refresh shell state:', error);
  } finally {
    refreshInProgress = false;
  }
}

function getWindowLabel(payload: Record<string, unknown> = {}) {
  return typeof payload.id === 'string' ? payload.id : '';
}

async function getWindowAction(payload: Record<string, unknown>, action: string) {
  const id = getWindowLabel(payload);
  if (!id) throw new Error('A window id is required');
  const isNative = payload.kind === 'native'
    || lastState?.hiddenWindows.some((item) => item.id === id);
  if (isNative) {
    return nodeRequest('manage-hidden-window', { id, action });
  }
  return invoke('manage_program_window', { label: id, action });
}

async function dispatch(channel: string, payload: Record<string, unknown> = {}) {
  if (channel.startsWith('window:')) {
    const action = channel.slice('window:'.length);
    if (action === 'set-bounds') {
      const bounds = payload.bounds as Record<string, number> | undefined;
      const id = getWindowLabel(payload);
      if (!id || !bounds) throw new Error('Window id and bounds are required');
      return invoke('set_program_window_bounds', { label: id, ...bounds });
    }

    if (channel === 'window:create') {
      const appId = typeof payload.appId === 'string' ? payload.appId : '';
      const url = typeof payload.url === 'string' ? payload.url : '';
      if (appId) {
        try {
          await invoke('open_program', { programId: appId, params: {} });
          return { ok: true };
        } catch (error) {
          const appList = await nodeRequest<Array<{ id: string; name: string }>>('list-programs');
          const app = appList.find((item) =>
            item.id === appId || item.name === appId);
          if (!app) throw error;
          await invoke('open_program', { programId: app.id, params: {} });
          return { ok: true };
        }
      }
      if (url) throw new Error('The browser card did not provide a launchable app id');
      return { ok: true };
    }

    if (['focus', 'close', 'minimize', 'maximize'].includes(action)) {
      return getWindowAction(payload, action);
    }
  }

  if (channel === 'launch-native-app') {
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (!id) throw new Error('A native app id is required');
    return nodeRequest('launch-native-app', { id });
  }

  if (channel.startsWith('native-window:')) {
    const action = channel.slice('native-window:'.length);
    if (action === 'prepare-drag') {
      const id = getWindowLabel(payload);
      const appWindows = await invoke<ProgramWindow[]>('list_program_windows');
      const target = appWindows.find((item) => item.label === id);
      return target
        ? { ok: true, bounds: { x: target.x, y: target.y, width: target.width, height: target.height } }
        : { ok: false, abort: true };
    }
    if (action === 'drag-end') return { ok: true };
    if (action === 'set-bounds') {
      throw new Error('Moving native windows is not migrated');
    }
    if (['focus', 'close', 'minimize', 'maximize'].includes(action)) {
      return getWindowAction({ ...payload, kind: 'native' }, action);
    }
  }

  switch (channel) {
    case 'topbar:toggle-overview':
      return invoke('toggle_overview');
    case 'topbar:open-overview':
      return invoke('open_overview');
    case 'topbar:close-overview':
      return invoke('close_overview');
    case 'topbar:focus-window':
      return getWindowAction(payload, 'focus');
    case 'topbar:close-window':
    case 'topbar:minimize-window':
    case 'topbar:maximize-window':
      return getWindowAction(payload, channel.slice('topbar:'.length).replace(/-window$/, ''));
    case 'topbar:open-window-settings':
      return invoke('open_window_settings', { label: getWindowLabel(payload) });
    case 'topbar:open-search':
      if (platform !== 'win32') return invoke('toggle_overview');
      return nodeRequest('open-everything');
    case 'topbar:open-settings':
      if (platform !== 'win32') throw new Error('System settings are only migrated on Windows');
      return invoke('open_program', {
        programId: 'componentapps:windows-settings',
        params: {},
      });
    case 'topbar:toggle-power-menu':
      throw new Error('The power menu is not migrated yet');
    case 'topbar:open-status':
      throw new Error('The development host is not migrated yet');
    default:
      throw new Error(`Unsupported topbar action: ${channel}`);
  }
}

export function installTopbarBridge() {
  if (window.electron_topbar_API) return;

  const viewApi = {
    getAppsList: () => nodeRequest('get-apps-list'),
    getProjectRoot: () => nodeRequest<{ projectRoot: string }>('health')
      .then((health) => health.projectRoot),
    dispatch: () => undefined,
    subscribe: () => undefined,
    unsubscribe: () => undefined,
    onStateUpdate: (callback: (state: TopbarState) => void) => {
      stateListeners.add(callback);
      return () => stateListeners.delete(callback);
    },
  };

  Object.assign(window, {
    electron_desktop_API: {
      platform,
      invoke: async (channel: string, payload: Record<string, unknown> = {}) => {
        if (channel === 'get-native-apps') {
          return nodeRequest<Array<{ id: string; name: string; launchType: string }>>('list-native-apps')
            .then((items) => items.map((item) => ({
              id: item.id,
              title: item.name,
              kind: 'native',
              launchType: item.launchType,
            })));
        }
        if (channel === 'get-extensions-list') return [];
        if (channel === 'topbar:get-state') return getTopbarState();
        return dispatch(channel, payload);
      },
      send: (channel: string, payload: Record<string, unknown> = {}) => {
        void dispatch(channel, payload).catch((error) => {
          console.error(`[tauri-desktop] ${channel} failed:`, error);
        });
      },
    },
    electron_view_API: viewApi,
  });

  const api: TopbarApi = {
    platform,
    invoke: async (channel, payload = {}) => {
      if (channel === 'topbar:get-state') return getTopbarState();
      if (channel === 'topbar:get-window-bounds') {
        const windows = await invoke<ProgramWindow[]>('list_program_windows');
        const target = windows.find((item) => item.label === getWindowLabel(payload));
        return target ? {
          x: target.x,
          y: target.y,
          width: target.width,
          height: target.height,
        } : null;
      }
      if (channel === 'native-window:prepare-drag') {
        return dispatch(channel, payload);
      }
      return dispatch(channel, payload);
    },
    send: (channel, payload = {}) => {
      void dispatch(channel, payload).catch((error) => {
        console.error(`[tauri-topbar] ${channel} failed:`, error);
      });
    },
    on: (channel, callback) => {
      if (channel !== 'topbar:state-update') return () => undefined;
      stateListeners.add(callback);
      if (lastState) callback(lastState);
      return () => stateListeners.delete(callback);
    },
  };

  window.electron_topbar_API = api;
  void publishState();
  window.setInterval(() => void publishState(), 1000);
  void listen('managed-windows-changed', () => void publishState())
    .then((unlisten) => {
      window.addEventListener('beforeunload', unlisten, { once: true });
    })
    .catch((error) => {
      console.error('[tauri-topbar] could not subscribe to window events:', error);
    });
}
