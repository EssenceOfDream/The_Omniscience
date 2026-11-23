import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import FileView from '../componentapps/desktop/components/FileView';
import FrameHandler from '../componentapps/desktop/components/FrameHandler';
import BackgroundRenderer from '../componentapps/desktop/components/BackgroundRenderer';
import ThemeApplier from '../componentapps/desktop/components/ThemeApplier';
import useViewStateBridge from '../componentapps/desktop/hooks/useViewStateBridge';
import { installDesktopBridge } from './desktop-bridge';
import { installWindowChrome, mountApp, nodeRequest } from './tauri';

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
      <div id="background-root" className="ignore_The_Omniscience_Theme_recursive">
        <ThemeProvider theme={darkTheme}>
          <ViewStateBridge />
          <ThemeApplier />
          <BackgroundRenderer />
        </ThemeProvider>
      </div>
      <div id="desktop-root">
        <ThemeProvider theme={darkTheme}>
          <CssBaseline />
          <FileView />
        </ThemeProvider>
      </div>
      <div id="frame-root">
        {[
          ['top-left', 'top-left'],
          ['top', 'top'],
          ['top-right', 'top-right'],
          ['left', 'left'],
          ['right', 'right'],
          ['bottom-left', 'bottom-left'],
          ['bottom', 'bottom'],
          ['bottom-right', 'bottom-right'],
        ].map(([position, direction]) => (
          <div
            key={position}
            className={`frame-handle ${position}`}
            data-resize={direction}
          />
        ))}
        <ThemeProvider theme={darkTheme}>
          <FrameHandler />
        </ThemeProvider>
      </div>
    </>
  );
}

mountApp(<Desktop />);
