import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Divider, Stack, Typography,
} from '@mui/material';
import { invoke, nodeRequest } from '../../src/tauri';

export default function OpenWindows() {
  const [windows, setWindows] = useState([]);
  const [hiddenWindows, setHiddenWindows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const activeRef = useRef(false);
  const refreshInProgressRef = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInProgressRef.current) return;
    refreshInProgressRef.current = true;
    try {
      const [programWindows, health] = await Promise.all([
        invoke('list_program_windows'),
        nodeRequest('health'),
      ]);
      const nativeWindows = health.platform === 'win32'
        ? await nodeRequest('list-hidden-windows')
        : [];
      if (activeRef.current) {
        setWindows(programWindows);
        setHiddenWindows(nativeWindows);
        setError('');
      }
    } catch (loadError) {
      if (activeRef.current) {
        setError(loadError.message || String(loadError));
      }
    } finally {
      refreshInProgressRef.current = false;
      if (activeRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const perform = async (item, action) => {
    try {
      if (item.kind === 'native') {
        await nodeRequest('manage-hidden-window', { id: item.id, action });
      } else {
        await invoke('manage_program_window', { label: item.label, action });
      }
      await refresh();
    } catch (actionError) {
      setError(actionError.message || String(actionError));
    }
  };

  const openSettings = async (item) => {
    try {
      await invoke('open_window_settings', { label: item.label });
    } catch (actionError) {
      setError(actionError.message || String(actionError));
    }
  };

  const rows = [
    ...windows.map((item) => ({ ...item, id: item.label, kind: 'our' })),
    ...hiddenWindows.map((item) => ({ ...item, kind: 'native' })),
  ];

  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto', boxSizing: 'border-box' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>Открытые окна</Typography>
        <Button size="small" onClick={() => void refresh()}>Обновить</Button>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      <Divider sx={{ mb: 1.5 }} />
      {loading && rows.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : rows.length === 0 ? (
        <Box sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
          Нет открытых окон
        </Box>
      ) : (
        <Stack spacing={1}>
          {rows.map((item) => (
            <Box
              key={`${item.kind}:${item.id}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                p: 1,
                border: '1px solid rgba(255,255,255,.12)',
                borderRadius: 1,
              }}
            >
              {item.icon && (
                <Box
                  component="img"
                  src={item.icon}
                  alt=""
                  draggable={false}
                  sx={{ width: 26, height: 26, objectFit: 'contain', flexShrink: 0 }}
                />
              )}
              <Box sx={{ flex: 1, minWidth: 100, overflow: 'hidden' }}>
                <Typography noWrap title={item.title}>
                  {item.title}{item.minimized ? ' (свернуто)' : ''}
                </Typography>
                {item.kind === 'native' && (
                  <Typography variant="caption" color="text.secondary">
                    Скрытое окно Windows
                  </Typography>
                )}
              </Box>
              <Button size="small" onClick={() => void perform(item, 'focus')}>
                {item.minimized ? 'Показать' : 'Активировать'}
              </Button>
              <Button size="small" onClick={() => void perform(item, 'minimize')}>
                {item.minimized ? 'Восстановить' : 'Свернуть'}
              </Button>
              <Button size="small" onClick={() => void perform(item, 'maximize')}>
                {item.maximized ? 'Обычный размер' : 'Развернуть'}
              </Button>
              {item.kind === 'our' && (
                <Button size="small" onClick={() => void openSettings(item)}>
                  Настройки
                </Button>
              )}
              <Button size="small" color="error" onClick={() => void perform(item, 'close')}>
                Закрыть
              </Button>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
