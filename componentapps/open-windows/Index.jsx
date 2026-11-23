import React from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import OpenWindows from './App.jsx';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#a855f7' },
    background: { default: '#1a001a', paper: '#2a002a' },
  },
});

createRoot(document.getElementById('root')).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <OpenWindows />
  </ThemeProvider>,
);
