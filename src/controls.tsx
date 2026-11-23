import { CssBaseline } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import ControlWindowContainer from '../componentapps/window-controls/components/ControlWindowContainer';
import { installTopbarBridge } from './topbar-bridge';
import { installWindowChrome, mountApp, nodeRequest } from './tauri';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#a855f7' },
  },
});

installTopbarBridge();
installWindowChrome();
nodeRequest<Record<string, unknown>>('get-theme')
  .then((settings) => installWindowChrome(settings))
  .catch((error) => console.error('[controls] could not load theme:', error));

function WindowControls() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ControlWindowContainer />
    </ThemeProvider>
  );
}

mountApp(<WindowControls />);
