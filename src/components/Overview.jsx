import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton, Paper, Tab, Tabs, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import useTabContentView from '../hooks/useTabContentView';
import { getOverviewViewId } from './overviewViewId.js';

function resolveVisibleTabs(apps, tabsConfig) {
  const appsById = new Map(apps.map((app) => [app.id, app]));
  return tabsConfig
    .filter((tab) => tab.visible)
    .map((tab) => {
      const app = appsById.get(tab.id);
      return app ? { id: tab.id, app, label: app.title || tab.id } : null;
    })
    .filter(Boolean);
}

function TabContent({ app, viewId, tabId, parentWindowId }) {
  const containerRef = useRef(null);
  useTabContentView(viewId, app, containerRef, { tabId, parentWindowId });
  return <Box ref={containerRef} sx={{ width: '100%', height: '100%' }} />;
}

export default function Overview({
  apps,
  tabsConfig,
  error,
  onClose,
  parentWindowId,
}) {
  const tabs = useMemo(
    () => resolveVisibleTabs(apps, tabsConfig),
    [apps, tabsConfig],
  );
  const [selectedTabId, setSelectedTabId] = useState(null);
  const selectedTab = tabs.find((tab) => tab.id === selectedTabId) || tabs[0] || null;

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((tab) => tab.id === selectedTabId)) {
      setSelectedTabId(tabs[0].id);
    }
  }, [tabs, selectedTabId]);

  const viewId = selectedTab
    ? getOverviewViewId(parentWindowId, selectedTab.id)
    : null;

  return (
    <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
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
            value={selectedTab?.id || false}
            onChange={(_event, tabId) => setSelectedTabId(tabId)}
            textColor="inherit"
            variant="scrollable"
          >
            {tabs.map((tab) => (
              <Tab
                key={tab.id}
                value={tab.id}
                label={tab.label}
                sx={{ color: 'rgba(255,255,255,0.7)', '&.Mui-selected': { color: '#fff' } }}
              />
            ))}
          </Tabs>
          <IconButton onClick={onClose} sx={{ color: 'white' }} aria-label="Закрыть">
            <CloseIcon />
          </IconButton>
        </Box>
      </Paper>

      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {error ? (
          <Typography role="alert" sx={{ p: 3, color: '#f88', textAlign: 'center' }}>
            {error}
          </Typography>
        ) : selectedTab && viewId && parentWindowId ? (
          <TabContent
            key={viewId}
            app={selectedTab.app}
            viewId={viewId}
            tabId={selectedTab.id}
            parentWindowId={parentWindowId}
          />
        ) : (
          <Typography sx={{ p: 3, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
            Нет доступных вкладок
          </Typography>
        )}
      </Box>
    </Box>
  );
}
