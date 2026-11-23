import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';

const api = window.electron_omniArchiver_API
  || (window.electron_omniArchiver_API = {});

function normalizePaths(selection) {
  if (selection === null) return [];
  return Array.isArray(selection) ? selection : [selection];
}

api.selectFiles = async (multiple) => {
  try {
    const paths = normalizePaths(await open({ multiple: Boolean(multiple) }));
    return paths.length ? { ok: true, paths } : { ok: false, error: 'cancelled' };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};

api.selectOutputDir = async () => {
  try {
    const paths = normalizePaths(await open({
      directory: true,
      createDirectory: true,
    }));
    return paths.length ? { ok: true, path: paths[0] } : { ok: false, error: 'cancelled' };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};

api.selectFolders = async () => {
  try {
    const paths = normalizePaths(await open({ directory: true, multiple: true }));
    return paths.length ? { ok: true, paths } : { ok: false, error: 'cancelled' };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};

api.selectSaveVhd = async () => {
  try {
    const path = await save({
      title: 'Сохранить VHD как...',
      defaultPath: 'archive.vhd',
      filters: [{ name: 'Virtual Hard Disk', extensions: ['vhd'] }],
    });
    return path ? { ok: true, path } : { ok: false, error: 'cancelled' };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
};

api.onFilesDropped = (callback) => {
  let active = true;
  let unlisten;
  void Promise.resolve()
    .then(() => getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') callback(event.payload.paths);
    }))
    .then((stop) => {
      if (active) unlisten = stop;
      else stop();
    })
    .catch((error) => {
      console.error('[omni-archiver] file-drop subscription failed:', error);
    });
  return () => {
    active = false;
    unlisten?.();
  };
};

document.documentElement.style.margin = '0';
document.body.style.margin = '0';
document.body.style.overflow = 'auto';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);