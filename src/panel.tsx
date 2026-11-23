import { CssBaseline, GlobalStyles } from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import TopBarContainer from '../componentapps/topbar-panel/components/TopBarContainer';
import { installTopbarBridge } from './topbar-bridge';
import { installWindowChrome, mountApp, nodeRequest } from './tauri';

const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#1a001a', paper: '#2a002a' },
    primary: { main: '#6f42c1' },
  },
});

installTopbarBridge();
installWindowChrome();
nodeRequest<Record<string, unknown>>('get-theme')
  .then((settings) => installWindowChrome(settings))
  .catch((error) => console.error('[panel] could not load theme:', error));

function Panel() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={{
        'html, body, #root': {
          width: '100vw',
          height: '100vh',
          margin: 0,
          padding: 0,
          overflow: 'hidden',
          background: 'transparent !important',
        },
      }} />
      <TopBarContainer />
    </ThemeProvider>
  );
}

mountApp(<Panel />);
