import { openPath } from '@tauri-apps/plugin-opener';
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
      openPath: (path: string) => Promise<void>;
      getFileIcon: (path: string) => Promise<{ success: boolean; fileUrl: string | null }>;
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
const watchedDirectories = new Map<string, number>();

function on(channel: string, listener: (...args: unknown[]) => void) {
  const set = listeners.get(channel) || new Set();
  set.add(listener as (payload: unknown) => void);
  listeners.set(channel, set);
  return () => set.delete(listener as (payload: unknown) => void);
}

function emit(channel: string, payload: unknown) {
  for (const listener of listeners.get(channel) || []) listener(payload);
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
    openPath: async (path: string) => {
      await openPath(path);
    },
    getFileIcon: (path: string) =>
      nodeRequest<{ success: boolean; fileUrl: string | null }>('get-file-icon', { path }),
    watchStart: (path: string) => {
      if (watchedDirectories.has(path)) return;
      const timer = window.setInterval(() => {
        void nodeRequest<DirectoryResult>('list-directory', { path })
          .then(() => emit('fs:did-change', { dir: path }))
          .catch(() => undefined);
      }, 1500);
      watchedDirectories.set(path, timer);
    },
    watchStop: (path: string) => {
      const timer = watchedDirectories.get(path);
      if (timer) window.clearInterval(timer);
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
