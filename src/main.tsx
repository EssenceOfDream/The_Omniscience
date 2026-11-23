import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import FileView from '../componentapps/desktop/components/FileView';
import BackgroundRenderer from '../componentapps/desktop/components/BackgroundRenderer';
import ThemeApplier from '../componentapps/desktop/components/ThemeApplier';
import useViewStateBridge from '../componentapps/desktop/hooks/useViewStateBridge';
import { installDesktopBridge } from './desktop-bridge';
import { installWindowChrome, mountApp, nodeRequest } from './tauri';
import './App.css';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#1a001a', paper: '#2a002a' },
    primary: { main: '#6f42c1' },
  },
});

installDesktopBridge();
installWindowChrome();
nodeRequest<Record<string, unknown>>('get-theme')
  .then((settings) => installWindowChrome(settings))
  .catch((error) => console.error('[desktop] could not load theme:', error));

function ViewStateBridge() {
  useViewStateBridge({}, () => undefined);
  return null;
}

function Desktop() {
  return (
    <>
      <div
        id="background-root"
        className="ignore_The_Omniscience_Theme_recursive"
        style={{ position: 'fixed', inset: 0, zIndex: 0 }}
      >
        <ThemeProvider theme={darkTheme}>
          <ViewStateBridge />
          <ThemeApplier />
          <BackgroundRenderer />
        </ThemeProvider>
      </div>
      <div
        id="desktop-root"
        style={{ position: 'fixed', top: 72, left: 0, right: 0, bottom: 0, zIndex: 1 }}
      >
        <ThemeProvider theme={darkTheme}>
          <CssBaseline />
          <FileView />
        </ThemeProvider>
      </div>
    </>
  );
}

mountApp(<Desktop />);
