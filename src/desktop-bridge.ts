import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { nodeRequest } from './tauri';

type DirectoryResult = {
  path: string;
  entries: Array<{
    name: string;
    path: string;
    kind: 'directory' | 'file' | 'symlink' | 'other';
    size: number;
    modifiedAt: number;
  }>;
};

declare global {
  interface Window {
    electron_mainWindow_API?: {
      onWindowStateChange: (listener: (state: { maximized: boolean; fullscreen: boolean }) => void) => () => void;
      startResize: (direction: string) => void;
      sendResizeMove: (screenX: number, screenY: number) => void;
      endResize: () => void;
    };
    electron_desktop_API?: {
      platform: string;
      getUserDirs: () => Promise<Record<string, string>>;
      readDir: (directory: string, desktopRoot: string) => Promise<{
        success: boolean;
        files: Array<Record<string, unknown>>;
        directoryMetadata: Record<string, unknown> | null;
        error?: string;
      }>;
      openPath: (path: string) => Promise<unknown>;
      openWith: (path: string) => Promise<unknown>;
      revealPath: (path: string) => Promise<unknown>;
      copyFiles: (paths: string[]) => Promise<unknown>;
      cutFiles: (paths: string[]) => Promise<unknown>;
      pasteFiles: (directory: string) => Promise<unknown>;
      dropPaths: (paths: string[], directory: string, isMove?: boolean) => Promise<{
        success: boolean;
        results: Array<Record<string, unknown>>;
      }>;
      writeDroppedFiles: (files: Array<{ name: string; data: Uint8Array }>, directory: string) => Promise<{
        success: boolean;
        results: Array<Record<string, unknown>>;
      }>;
      startDrag: (paths: string[]) => Promise<unknown>;
      getCutPaths: () => Promise<string[]>;
      clearCut: () => Promise<unknown>;
      deletePath: (path: string) => Promise<unknown>;
      showContextMenu: (options: Record<string, unknown>) => Promise<unknown>;
      getFileIcon: (path: string) => Promise<{ success: boolean; fileUrl: string | null }>;
      getFileIcons: (paths: string[]) => Promise<Record<string, string | null>>;
      watchStart: (path: string) => void;
      watchStop: (path: string) => void;
      createFolder: (directory: string, name: string) => Promise<unknown>;
      createFile: (directory: string, name: string) => Promise<unknown>;
      renamePath: (path: string, name: string) => Promise<unknown>;
      trashPath: (path: string) => Promise<void>;
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
      send: (channel: string, payload?: unknown) => void;
      invoke: (channel: string, payload?: unknown) => Promise<unknown>;
      getProjectRoot: () => Promise<string>;
    };
  }
}

const listeners = new Map<string, Set<(payload: unknown) => void>>();
type DirectoryWatch = {
  timer: number;
  snapshot: string | null;
  pending: boolean;
  lastError: string | null;
};
const watchedDirectories = new Map<string, DirectoryWatch>();

function on(channel: string, listener: (...args: unknown[]) => void) {
  const set = listeners.get(channel) || new Set();
  set.add(listener as (payload: unknown) => void);
  listeners.set(channel, set);
  return () => set.delete(listener as (payload: unknown) => void);
}

function emit(channel: string, payload: unknown) {
  for (const listener of listeners.get(channel) || []) listener(payload);
}

async function pollDirectory(path: string, watch: DirectoryWatch) {
  if (watch.pending || watchedDirectories.get(path) !== watch) return;
  watch.pending = true;

  try {
    const result = await nodeRequest<DirectoryResult>('list-directory', { path });
    if (watchedDirectories.get(path) !== watch) return;

    const snapshot = JSON.stringify(result.entries.map((entry) => [
      entry.name,
      entry.path,
      entry.kind,
      entry.size,
      entry.modifiedAt,
    ]));
    if (watch.snapshot !== null && snapshot !== watch.snapshot) {
      emit('fs:did-change', { dir: path });
    }
    watch.snapshot = snapshot;
    watch.lastError = null;
  } catch (error) {
    if (watchedDirectories.get(path) !== watch) return;
    const message = error instanceof Error ? error.message : String(error);
    if (watch.lastError !== message) {
      console.error(`[desktop] could not monitor directory ${path}:`, error);
      watch.lastError = message;
    }
  } finally {
    watch.pending = false;
  }
}

export function installDesktopBridge() {
  if (window.electron_desktop_API) return;

  const bridge = {
    platform: '',
    getUserDirs: () => nodeRequest<Record<string, string>>('get-user-dirs'),
    readDir: async (directory: string, _desktopRoot: string) => {
      try {
        const result = await nodeRequest<DirectoryResult>('list-directory', { path: directory });
        return {
          success: true,
          files: result.entries.map((entry) => ({
            id: entry.path,
            name: entry.name,
            displayName: entry.name,
            isDir: entry.kind === 'directory',
            mediaKind: null,
            fileUrl: null,
            iconPath: null,
            infoTip: null,
            size: entry.size,
            modifiedAt: entry.modifiedAt,
          })),
          directoryMetadata: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          files: [],
          directoryMetadata: null,
          error: message.includes('ENOENT') || message.includes('not found')
            ? 'permission_denied'
            : message,
        };
      }
    },
    openPath: (path: string) => nodeRequest('open-path', { path }),
    openWith: (path: string) => nodeRequest('open-with', { path }),
    revealPath: (path: string) => nodeRequest('reveal-path', { path }),
    copyFiles: (paths: string[]) => nodeRequest('copy-files', { paths }),
    cutFiles: (paths: string[]) => nodeRequest('cut-files', { paths }),
    pasteFiles: (directory: string) => nodeRequest('paste-files', { dir: directory }),
    dropPaths: (paths: string[], directory: string, isMove = false) =>
      nodeRequest<{ success: boolean; results: Array<Record<string, unknown>> }>(
        'drop-paths',
        { paths, dir: directory, isMove },
      ),
    writeDroppedFiles: (files: Array<{ name: string; data: Uint8Array }>, directory: string) =>
      nodeRequest<{ success: boolean; results: Array<Record<string, unknown>> }>(
        'write-dropped-files',
        { files, dir: directory },
      ),
    startDrag: (paths: string[]) => invoke('start_file_drag', { paths }),
    getCutPaths: () => nodeRequest<string[]>('get-cut-paths'),
    clearCut: () => nodeRequest('clear-cut'),
    deletePath: (path: string) => nodeRequest('delete-path', { path }),
    showContextMenu: (options: Record<string, unknown>) =>
      invoke('show_desktop_context_menu', options),
    getFileIcon: async (path: string) => {
      const icons = await invoke<Record<string, string | null>>('get_file_icons', { paths: [path] });
      const fileUrl = icons[path] || null;
      return { success: Boolean(fileUrl), fileUrl };
    },
    getFileIcons: (paths: string[]) =>
      invoke<Record<string, string | null>>('get_file_icons', { paths }),
    watchStart: (path: string) => {
      if (watchedDirectories.has(path)) return;
      const watch: DirectoryWatch = {
        timer: 0,
        snapshot: null,
        pending: false,
        lastError: null,
      };
      watchedDirectories.set(path, watch);
      void pollDirectory(path, watch);
      watch.timer = window.setInterval(() => {
        void pollDirectory(path, watch);
      }, 1500);
    },
    watchStop: (path: string) => {
      const watch = watchedDirectories.get(path);
      if (watch) window.clearInterval(watch.timer);
      watchedDirectories.delete(path);
    },
    createFolder: (directory: string, name: string) =>
      nodeRequest('create-folder', { parentPath: directory, name }),
    createFile: (directory: string, name: string) =>
      nodeRequest('create-file', { parentPath: directory, name }),
    renamePath: (path: string, name: string) =>
      nodeRequest('rename-path', { path, name }),
    trashPath: (path: string) => invoke<void>('trash_path', { path }),
    on,
    send: (channel: string, payload?: unknown) => {
      if (channel === 'theme:enabled-changed') {
        return;
      }
      void invoke(channel, payload as Record<string, unknown> | undefined).catch((error) => {
        console.error(`[desktop] unsupported channel ${channel}:`, error);
      });
    },
    invoke: (channel: string, payload?: unknown) => {
      if (channel === 'get-user-dirs') return nodeRequest('get-user-dirs');
      if (channel === 'read-desktop-directory') {
        return nodeRequest('read-desktop-directory', payload as object);
      }
      return invoke(channel, payload as Record<string, unknown> | undefined);
    },
    getProjectRoot: () => nodeRequest<{ projectRoot: string }>('health')
      .then((health) => health.projectRoot),
  };

  void nodeRequest<{ platform: string }>('health')
    .then((health) => {
      bridge.platform = health.platform;
    })
    .catch((error) => console.error('[desktop] could not load platform:', error));

  void listen<{ action: string; context: Record<string, unknown> }>(
    'desktop-context-menu-action',
    ({ payload }) => emit('desktop-context-menu-action', payload),
  ).catch((error) => console.error('[desktop] context menu event listener failed:', error));
  void listen<{ paths?: string[] }>('tauri://drag-drop', ({ payload }) => {
    emit('desktop-native-drop', payload);
  }).catch((error) => console.error('[desktop] file drop listener failed:', error));

  window.electron_desktop_API = bridge;
  window.electron_mainWindow_API = {
    onWindowStateChange: (listener) => {
      listener({ maximized: false, fullscreen: false });
      return () => undefined;
    },
    startResize: () => undefined,
    sendResizeMove: () => undefined,
    endResize: () => undefined,
  };

  void listen('managed-windows-changed', () => {
    emit('fs:did-change', { dir: null });
  }).catch((error) => {
    console.error('[desktop] could not subscribe to Tauri events:', error);
  });
}
