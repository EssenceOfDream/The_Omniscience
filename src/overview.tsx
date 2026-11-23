import { useEffect, useState } from 'react';
import {
  Box,
  CssBaseline,
  IconButton,
  Paper,
  Tab,
  Tabs,
  ThemeProvider,
  createTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AppsListApp from '../componentapps/apps-list/App';
import SettingsApp from '../componentapps/settings/App';
import {
  installWindowChrome,
  invoke,
  listen,
  mountApp,
  nodeRequest,
  type ProgramWindow,
} from './tauri';
import { installTopbarBridge } from './topbar-bridge';

const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#1a001a', paper: '#2a002a' },
    primary: { main: '#a855f7' },
  },
});

type HiddenWindow = {
  id: string;
  title: string;
  processName: string | null;
  minimized: boolean;
  maximized: boolean;
  focused: boolean;
};

installTopbarBridge();
installWindowChrome();

nodeRequest<Record<string, unknown>>('get-theme')
  .then((settings) => installWindowChrome(settings))
  .catch((error) => console.error('[overview] could not load theme:', error));

function OpenWindows() {
  const [windows, setWindows] = useState<ProgramWindow[]>([]);
  const [hidden, setHidden] = useState<HiddenWindow[]>([]);

  const refresh = () => {
    void invoke<ProgramWindow[]>('list_program_windows').then(setWindows);
    void nodeRequest<{ platform: string }>('health').then(async (health) => {
      setHidden(health.platform === 'win32'
        ? await nodeRequest<HiddenWindow[]>('list-hidden-windows')
        : []);
    });
  };

  useEffect(() => {
    refresh();
    const unlisten = listen('managed-windows-changed', () => void refresh());
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const manage = (label: string, action: string) => {
    void invoke('manage_program_window', { label, action }).then(refresh);
  };

  const manageHidden = (
    id: string,
    action: 'focus' | 'minimize' | 'maximize' | 'close',
  ) => {
    void nodeRequest('manage-hidden-window', { id, action }).then(refresh);
  };

  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Box sx={{ display: 'grid', gap: 1 }}>
        {windows.map((item) => (
          <Box
            key={item.label}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              p: 1,
              border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 1,
            }}
          >
            <Box sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.title}{item.minimized ? ' (свернуто)' : ''}
            </Box>
            <button onClick={() => manage(item.label, item.minimized ? 'focus' : 'minimize')}>
              {item.minimized ? 'Показать' : 'Свернуть'}
            </button>
            <button onClick={() => void invoke('open_window_settings', { label: item.label })}>
              Настройки
            </button>
            <button onClick={() => manage(item.label, 'close')}>Закрыть</button>
          </Box>
        ))}
        {hidden.map((item) => (
          <Box
            key={item.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              p: 1,
              border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 1,
            }}
          >
            <Box sx={{ flex: 1 }}>{item.title} (скрытое окно)</Box>
            <button onClick={() => manageHidden(item.id, 'focus')}>Показать</button>
            <button onClick={() => manageHidden(
              item.id,
              item.minimized ? 'focus' : 'minimize',
            )}>
              {item.minimized ? 'Восстановить' : 'Свернуть'}
            </button>
            <button onClick={() => manageHidden(item.id, 'maximize')}>Развернуть</button>
            <button onClick={() => manageHidden(item.id, 'close')}>Закрыть</button>
          </Box>
        ))}
        {!windows.length && !hidden.length && (
          <Box sx={{ p: 3, textAlign: 'center', opacity: 0.65 }}>
            Нет открытых окон
          </Box>
        )}
      </Box>
    </Box>
  );
}

function OverviewPage() {
  const [tab, setTab] = useState('apps-list');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void invoke('close_overview');
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          position: 'fixed',
          inset: 0,
          bgcolor: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(16px)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Paper
          elevation={0}
          sx={{
            bgcolor: 'transparent',
            borderRadius: 0,
            p: 1,
            borderBottom: '1px solid rgba(255,255,255,0.12)',
            flexShrink: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Tabs
              value={tab}
              onChange={(_, value) => setTab(value)}
              textColor="inherit"
              variant="scrollable"
            >
              <Tab
                value="apps-list"
                label="Приложения"
                sx={{ color: 'rgba(255,255,255,0.7)', '&.Mui-selected': { color: '#fff' } }}
              />
              <Tab
                value="open-windows"
                label="Открытые окна"
                sx={{ color: 'rgba(255,255,255,0.7)', '&.Mui-selected': { color: '#fff' } }}
              />
              <Tab
                value="settings"
                label="Настройки"
                sx={{ color: 'rgba(255,255,255,0.7)', '&.Mui-selected': { color: '#fff' } }}
              />
            </Tabs>
            <IconButton
              onClick={() => void invoke('close_overview')}
              sx={{ color: 'white' }}
              aria-label="Закрыть"
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </Paper>
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {tab === 'apps-list' && <AppsListApp desktopId="" />}
          {tab === 'open-windows' && <OpenWindows />}
          {tab === 'settings' && <SettingsApp />}
        </Box>
      </Box>
    </ThemeProvider>
  );
}

mountApp(<OverviewPage />);
