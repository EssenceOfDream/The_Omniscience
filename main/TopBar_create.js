import electronPkg from 'electron';
const { BrowserWindow, screen } = electronPkg;
import path from 'path';
import {
  enableWindowsBackdropBlur, getWindowsExplorerTaskbarBounds, recoverWindowsShell,
} from './ipc_nativeWindows.js';
import { getWindowsPanelLayout } from './windowsPanelLayout.js';
import { forceWindowPlacementAboveTaskbar } from './topbarPlacement.js';
import { installWindowsBackdropBlur } from './windowsBackdrop.js';

const TOPBAR_H = process.platform === 'win32' ? 28 : 72;
const CONTROL_WINDOW_W = 112;

function ensureControlWindowAboveTaskbar(bounds) {
  const win = global.controlWindow;
  if (!win || win.isDestroyed()) return;

  try {
    forceWindowPlacementAboveTaskbar(win, bounds);
  } catch (error) {
    console.error('[topbar] failed to keep window controls above the Windows taskbar:', error.message);
  }
}

function ensureTopbarAboveTaskbar(bounds) {
  const win = global.topbarWindow;
  if (!win || win.isDestroyed()) return;

  try {
    forceWindowPlacementAboveTaskbar(win, bounds);
  } catch (error) {
    console.error('[topbar] failed to keep the panel above the Windows taskbar:', error.message);
  }
}

export default async function () {
  const getPanelLayout = async () => {
    const display = screen.getPrimaryDisplay();
    const bounds = display.bounds;
    if (process.platform !== 'win32') {
      return {
        topbar: { x: bounds.x, y: bounds.y, width: bounds.width, height: TOPBAR_H },
        controls: null,
      };
    }

    const nativeTaskbarBounds = await getWindowsExplorerTaskbarBounds();
    const taskbarBounds = screen.screenToDipRect(null, nativeTaskbarBounds);
    return getWindowsPanelLayout(bounds, taskbarBounds, TOPBAR_H, CONTROL_WINDOW_W);
  };
  let layout = await getPanelLayout();

  global.topbarWindow = new BrowserWindow({
    title: 'The_Omniscience_panel',
    ...layout.topbar,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    type: 'dock',
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(global.paths.componentappsDir, 'topbar-panel', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });
  installWindowsBackdropBlur(global.topbarWindow, { apply: enableWindowsBackdropBlur });

  const reportRendererFailure = (reason) => {
    recoverWindowsShell(reason).catch((error) => {
      console.error('[topbar] shell recovery failed:', error.message);
    });
  };
  global.topbarWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, description, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        reportRendererFailure(`TopBar failed to load (${errorCode}): ${description}`);
      }
    },
  );
  global.topbarWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') {
      reportRendererFailure(`TopBar renderer exited: ${details.reason} (${details.exitCode})`);
    }
  });

  const topbarUrl = process.platform === 'win32'
    ? `${global.paths.topBarIndex}?windows=1`
    : global.paths.topBarIndex;
  global.topbarWindow.loadURL(topbarUrl).catch((error) => {
    reportRendererFailure(`TopBar load failed: ${error.message}`);
  });
  global.topbarWindow.once('ready-to-show', () => ensureTopbarAboveTaskbar(layout.topbar));
  global.topbarWindow.on('show', () => ensureTopbarAboveTaskbar(layout.topbar));
  global.topbarWindow.on('restore', () => ensureTopbarAboveTaskbar(layout.topbar));
  const topbarPlacementTimer = setInterval(
    () => ensureTopbarAboveTaskbar(layout.topbar),
    1000,
  );
  topbarPlacementTimer.unref();
  global.topbarWindow.once('closed', () => clearInterval(topbarPlacementTimer));

  if (layout.controls) {
    global.controlWindow = new BrowserWindow({
      title: 'Omniscience window controls',
      ...layout.controls,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      type: 'toolbar',
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(global.paths.componentappsDir, 'window-controls', 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
    });
    installWindowsBackdropBlur(global.controlWindow, { apply: enableWindowsBackdropBlur });
    global.controlWindow.setAlwaysOnTop(true, 'screen-saver');
    global.controlWindow.webContents.on('did-fail-load', (
      _event, errorCode, description, _url, isMainFrame,
    ) => {
      if (isMainFrame && errorCode !== -3) {
        reportRendererFailure(`Window controls failed to load (${errorCode}): ${description}`);
      }
    });
    global.controlWindow.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason !== 'clean-exit') {
        reportRendererFailure(`Window controls renderer exited: ${details.reason} (${details.exitCode})`);
      }
    });
    global.controlWindow.loadURL(global.paths.windowControlsIndex).catch((error) => {
      reportRendererFailure(`Window controls load failed: ${error.message}`);
    });
    global.controlWindow.once('ready-to-show', () => {
      if (global.controlWindow.isDestroyed()) return;
      ensureControlWindowAboveTaskbar(layout.controls);
      global.controlWindow.showInactive();
      ensureControlWindowAboveTaskbar(layout.controls);
    });
    global.controlWindow.on('show', () => ensureControlWindowAboveTaskbar(layout.controls));
    global.controlWindow.on('restore', () => ensureControlWindowAboveTaskbar(layout.controls));
    const controlZOrderTimer = setInterval(
      () => ensureControlWindowAboveTaskbar(layout.controls),
      1000,
    );
    controlZOrderTimer.unref();
    global.controlWindow.once('closed', () => clearInterval(controlZOrderTimer));
  }

  const handleDisplayMetricsChanged = (_event, display, changedMetrics) => {
    if (display.id !== screen.getPrimaryDisplay().id || !changedMetrics.includes('bounds')) return;
    getPanelLayout().then((nextLayout) => {
      layout = nextLayout;
      ensureTopbarAboveTaskbar(layout.topbar);
      if (global.controlWindow && !global.controlWindow.isDestroyed() && layout.controls) {
        ensureControlWindowAboveTaskbar(layout.controls);
      }
    }).catch((error) => {
      console.error('[topbar] failed to update shell panel bounds:', error.message);
    });
  };
  screen.on('display-metrics-changed', handleDisplayMetricsChanged);
  global.topbarWindow.once('closed', () => {
    screen.removeListener('display-metrics-changed', handleDisplayMetricsChanged);
  });

  global.$.initPanelStruts();
}