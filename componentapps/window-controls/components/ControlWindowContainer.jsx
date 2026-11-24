import React, { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import ControlGrid from './ControlGrid';

export default function ControlWindowContainer() {
  const [activeWindow, setActiveWindow] = useState(null);
  const [crossMode, setCrossMode] = useState(false);

  const setControlsMode = (nextCrossMode) => {
    if (crossMode === nextCrossMode) return;
    setCrossMode(nextCrossMode);

    const invoke = window.electron_topbar_API?.invoke;
    if (!invoke) return;
    invoke('topbar:set-controls-cross-mode', { crossMode: nextCrossMode }).catch((error) => {
      console.error('[control-window] failed to change controls mode:', error);
      setCrossMode(!nextCrossMode);
    });
  };

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
        crossMode={crossMode}
        onToggleMode={() => setControlsMode(!crossMode)}
        onOpenWindowSettings={(id) => {
          window.electron_topbar_API?.send('topbar:open-window-settings', { id });
        }}
      />
    </Box>
  );
}
