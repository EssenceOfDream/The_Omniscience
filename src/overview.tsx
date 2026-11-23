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
import OpenWindowsApp from '../componentapps/open-windows/App';
import SettingsApp from '../componentapps/settings/App';
import {
  installWindowChrome,
  invoke,
  mountApp,
  nodeRequest,
} from './tauri';
import { useSetting } from './settings/useSettings';
import { installTopbarBridge } from './topbar-bridge';
import './App.css';

const overviewTabDefinitions = [
  { id: 'apps-list', label: 'Приложения' },
  { id: 'open-windows', label: 'Открытые окна' },
  { id: 'settings', label: 'Настройки' },
];

const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#1a001a', paper: '#2a002a' },
    primary: { main: '#a855f7' },
  },
});

installTopbarBridge();
installWindowChrome();

nodeRequest<Record<string, unknown>>('get-theme')
  .then((settings) => installWindowChrome(settings))
  .catch((error) => console.error('[overview] could not load theme:', error));

function OverviewPage() {
  const [tab, setTab] = useState('apps-list');
  const configuredTabs = useSetting('overviewTabs');
  const visibleTabs = (Array.isArray(configuredTabs) ? configuredTabs : [])
    .filter((entry) => entry.visible)
    .map((entry) => overviewTabDefinitions.find((definition) => definition.id === entry.id))
    .filter(Boolean);
  const tabs = visibleTabs.length
    ? visibleTabs
    : [overviewTabDefinitions.find((definition) => definition.id === 'settings')];
  const activeTab = tabs.some((entry) => entry.id === tab) ? tab : tabs[0].id;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void invoke('close_overview');
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    if (tab !== activeTab) setTab(activeTab);
  }, [activeTab, tab]);

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
              value={activeTab}
              onChange={(_, value) => setTab(value)}
              textColor="inherit"
              variant="scrollable"
            >
              {tabs.map((entry) => (
                <Tab
                  key={entry.id}
                  value={entry.id}
                  label={entry.label}
                  sx={{ color: 'rgba(255,255,255,0.7)', '&.Mui-selected': { color: '#fff' } }}
                />
              ))}
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
          {activeTab === 'apps-list' && <AppsListApp desktopId="" />}
          {activeTab === 'open-windows' && <OpenWindowsApp />}
          {activeTab === 'settings' && <SettingsApp />}
        </Box>
      </Box>
    </ThemeProvider>
  );
}

mountApp(<OverviewPage />);
