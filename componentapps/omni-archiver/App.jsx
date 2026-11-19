import React from 'react';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import VhdArchiver from './VhdArchiver.jsx';

const theme = createTheme({
  palette: { mode: 'dark', background: { default: '#1a001a', paper: '#2a002a' }, primary: { main: '#6f42c1' } },
  typography: { fontFamily: '"Segoe UI", Arial, sans-serif' },
});

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <VhdArchiver />
    </ThemeProvider>
  );
}