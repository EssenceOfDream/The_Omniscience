import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import PowerMenu from './App.jsx';
import { installTopbarBridge } from '../../src/topbar-bridge';

installTopbarBridge();

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#a855f7' },
    background: { default: 'transparent', paper: '#1e1e2e' },
  },
});

createRoot(document.getElementById('PowerMenu-root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <PowerMenu />
    </ThemeProvider>
  </React.StrictMode>,
);
