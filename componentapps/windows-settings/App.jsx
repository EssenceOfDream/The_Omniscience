import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import SettingsHome from './SettingsHome';

export default function App() {
  const theme = createTheme({
    palette: {
      mode: 'dark',
      background: { default: '#1a001a', paper: '#2a002a' },
      primary: { main: '#6f42c1' },
    },
    typography: {
      fontFamily: '"Segoe UI", Arial, sans-serif',
    },
  });

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SettingsHome />
    </ThemeProvider>
  );
}