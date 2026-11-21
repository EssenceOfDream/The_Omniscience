import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import ControlWindowContainer from './components/ControlWindowContainer';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#a855f7' },
  },
});

document.addEventListener('DOMContentLoaded', () => {
  createRoot(document.getElementById('WindowControls-root')).render(
    <React.StrictMode>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ControlWindowContainer />
      </ThemeProvider>
    </React.StrictMode>
  );
});
