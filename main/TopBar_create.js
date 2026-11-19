import electronPkg from 'electron';
const { BrowserWindow, screen } = electronPkg;
import {
  getWindowsExplorerTaskbarBounds, recoverWindowsShell,
} from './ipc_nativeWindows.js';
import { getWindowsPanelLayout } from './windowsPanelLayout.js';

const TOPBAR_H = process.platform === 'win32' ? 36 : 72;
const CONTROL_WINDOW_W = 72;

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
      preload: global.paths.reactPreload,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

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
        preload: global.paths.reactPreload,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
    });
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
    global.controlWindow.loadURL(`${global.paths.topBarIndex}?controls=1`).catch((error) => {
      reportRendererFailure(`Window controls load failed: ${error.message}`);
    });
    global.controlWindow.once('ready-to-show', () => {
      if (global.controlWindow.isDestroyed()) return;
      global.controlWindow.setAlwaysOnTop(true, 'screen-saver');
      global.controlWindow.showInactive();
    });
  }

  const handleDisplayMetricsChanged = (_event, display, changedMetrics) => {
    if (display.id !== screen.getPrimaryDisplay().id || !changedMetrics.includes('bounds')) return;
    getPanelLayout().then((nextLayout) => {
      layout = nextLayout;
      if (!global.topbarWindow.isDestroyed()) global.topbarWindow.setBounds(layout.topbar);
      if (global.controlWindow && !global.controlWindow.isDestroyed() && layout.controls) {
        global.controlWindow.setBounds(layout.controls);
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