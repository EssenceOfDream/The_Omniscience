import React, { useCallback, useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import Overview from './Overview';

function getOverviewInstanceId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('overviewInstance') || params.get('windowId') || null;
}

function useOverviewState() {
  const [overviewState, setOverviewState] = useState({
    apps: [],
    tabs: [],
    error: null,
  });

  useEffect(() => {
    const api = window.electron_overview_API;
    if (!api) {
      setOverviewState((state) => ({
        ...state,
        error: 'Не удалось подключить интерфейс Overview.',
      }));
      return undefined;
    }

    let active = true;
    const unsubscribe = api.on('topbar:state-update', (patch) => {
      if (!active || !patch) return;
      setOverviewState((state) => ({
        ...state,
        ...(Array.isArray(patch.apps) ? { apps: patch.apps } : {}),
        ...(Array.isArray(patch.overviewTabs) ? { tabs: patch.overviewTabs } : {}),
      }));
    });

    api.invoke('topbar:get-state')
      .then((state) => {
        if (!active || !state) return;
        setOverviewState((previous) => ({
          ...previous,
          apps: Array.isArray(state.apps) ? state.apps : [],
          tabs: Array.isArray(state.overviewTabs) ? state.overviewTabs : [],
          error: null,
        }));
      })
      .catch((error) => {
        console.error('[overview] failed to load state:', error);
        if (active) {
          setOverviewState((state) => ({
            ...state,
            error: 'Не удалось загрузить список вкладок.',
          }));
        }
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return overviewState;
}

export default function OverviewContainer() {
  const overviewInstanceId = getOverviewInstanceId();
  const { apps, tabs, error } = useOverviewState();
  const close = useCallback(() => {
    window.electron_overview_API?.send('overview:close');
  }, []);

  useEffect(() => {
    if (!overviewInstanceId) {
      console.error('[overview] missing window instance identifier');
    }
  }, [overviewInstanceId]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  return (
    <Box
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      sx={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        bgcolor: 'rgba(0,0,0,0.75)',
        overflow: 'hidden',
      }}
    >
      <Overview
        apps={apps}
        tabsConfig={tabs}
        error={error}
        onClose={close}
        parentWindowId={overviewInstanceId}
      />
      {!overviewInstanceId && (
        <Typography role="alert" sx={{ position: 'absolute', top: 72, p: 2, color: '#f88' }}>
          Не удалось определить экземпляр окна Overview.
        </Typography>
      )}
    </Box>
  );
}
