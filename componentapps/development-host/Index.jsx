import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import DevelopmentHostMenu from './App.jsx';
import { installTopbarBridge } from '../../src/topbar-bridge';

installTopbarBridge();

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: 'rgba(168,85,247,0.42)',
      light: 'rgba(192,132,252,0.7)',
      dark: 'rgba(126,34,206,0.36)',
      contrastText: 'rgba(255,255,255,0.92)',
    },
    background: {
      default: 'transparent',
      paper: 'rgba(30,30,46,0.34)',
    },
    text: {
      primary: 'rgba(255,255,255,0.92)',
      secondary: 'rgba(255,255,255,0.64)',
      disabled: 'rgba(255,255,255,0.38)',
    },
    divider: 'rgba(255,255,255,0.3)',
  },
});

createRoot(document.getElementById('DevelopmentHost-root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <DevelopmentHostMenu />
    </ThemeProvider>
  </React.StrictMode>,
);
