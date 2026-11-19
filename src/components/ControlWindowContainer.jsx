import React, { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import ControlGrid from './ControlGrid';

export default function ControlWindowContainer() {
  const [activeWindow, setActiveWindow] = useState(null);

  useEffect(() => {
    const api = window.electron_topbar_API;
    if (!api) return;

    const applyState = (state) => {
      if (state) setActiveWindow(state.activeWindow || null);
    };

    api.invoke('topbar:get-state').then(applyState).catch((error) => {
      console.error('[control-window] failed to load initial state:', error.message);
    });

    return api.on('topbar:state-update', applyState);
  }, []);

  return (
    <Box sx={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      background: 'rgba(0,0,0,0.42)',
      backdropFilter: 'blur(8px)',
    }}>
      <ControlGrid
        activeWindow={activeWindow}
        onOpenWindowSettings={(id) => {
          window.electron_topbar_API?.send('topbar:open-window-settings', { id });
        }}
      />
    </Box>
  );
}
