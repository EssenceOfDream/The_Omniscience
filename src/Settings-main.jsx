import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import SettingsHome from './components/SettingsHome';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0078d4' },
    background: { default: '#ffffff', paper: '#ffffff' },
  },
  typography: {
    fontFamily: '"Segoe UI", Arial, sans-serif',
  },
});

createRoot(document.getElementById('Settings-root')).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <SettingsHome />
  </ThemeProvider>,
);
