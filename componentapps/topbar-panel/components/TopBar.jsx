import React from 'react';
import { Box, Button, IconButton } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import DeveloperModeIcon from '@mui/icons-material/DeveloperMode';

import Clock from './topbar/Clock';
import WindowList from './topbar/WindowList';

export default function TopBar({
  windows = [],
  hiddenWindows = [],
  activeWindow,
  isWindowsPanel = false,
  showWindowList = true,
  showClock = true,
  showClockMs = false,
  onToggleOverview,
  onOpenWindowSettings,
  onFocusWindow,
  onCloseWindow,
  onRequestSearch,
  onRequestSettings,
  onRequestLogout,
  onOpenDevelopmentHost,
  developmentStatus,
}) {
  const menuButton = (
    <Button
      size="small"
      variant="contained"
      startIcon={<MenuIcon sx={{ fontSize: 14 }} />}
      onClick={onToggleOverview}
      sx={{
        bgcolor: '#6f42c1',
        '&:hover': { bgcolor: '#5a32a3' },
        flexShrink: 0,
        textTransform: 'none',
        fontSize: 11,
        height: 26,
        minWidth: 0,
        px: 1,
        WebkitAppRegion: 'no-drag',
      }}
    >
      Меню
    </Button>
  );
  const controls = (
    <>
      {showClock && <Clock showMs={showClockMs} />}
      <IconButton size="small" onClick={onRequestSearch}
        aria-label="Поиск"
        sx={{ color: '#fff', WebkitAppRegion: 'no-drag', width: 24, height: 24 }}>
        <SearchIcon sx={{ fontSize: 14 }} />
      </IconButton>
      <IconButton size="small" onClick={onRequestSettings}
        aria-label="Параметры"
        title="Параметры"
        sx={{ color: '#fff', WebkitAppRegion: 'no-drag', width: 24, height: 24 }}>
        <SettingsIcon sx={{ fontSize: 14 }} />
      </IconButton>
      <IconButton size="small" onClick={onOpenDevelopmentHost}
        aria-label="Разработка Omniscience"
        title={developmentStatus?.changed?.length
          ? `Неприменённых изменений: ${developmentStatus.changed.length}`
          : 'Omniscience: изменений нет'}
        sx={{
          color: developmentStatus?.lastError ? '#ff6b6b'
            : developmentStatus?.busy ? '#64b5f6'
            : developmentStatus?.changed?.length ? '#ffd166'
            : '#8bc34a',
          WebkitAppRegion: 'no-drag', width: 24, height: 24,
        }}>
        <DeveloperModeIcon sx={{ fontSize: 14 }} />
      </IconButton>
      <IconButton size="small" onClick={onRequestLogout}
        aria-label="Меню питания"
        sx={{ color: '#fff', WebkitAppRegion: 'no-drag', width: 24, height: 24 }}>
        <PowerSettingsNewIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </>
  );

  return (
    <Box sx={{
      width: '100%', height: '100%',
      bgcolor: 'rgba(0,0,0,0.55)',
      display: 'flex',
      alignItems: isWindowsPanel ? 'center' : 'stretch',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}>
      {isWindowsPanel ? (
        <Box sx={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center',
          gap: 0.5, px: 1, minWidth: 0,
        }}>
          {menuButton}
          {(isWindowsPanel || showWindowList) && (
            <WindowList
              windows={hiddenWindows}
              onFocus={onFocusWindow}
              onClose={onCloseWindow}
            />
          )}
          {controls}
        </Box>
      ) : (
        <>
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Box sx={{
              height: 32, display: 'flex', alignItems: 'center',
              px: 1, gap: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)',
              minWidth: 0, overflow: 'hidden',
            }}>
              <Box sx={{ flex: 1, minWidth: 0 }} />
              {controls}
            </Box>
            <Box sx={{
              flex: 1, display: 'flex', alignItems: 'center',
              px: 1, gap: 0.5, minHeight: 0, minWidth: 0, overflow: 'hidden',
            }}>
              {menuButton}
              {showWindowList && (
                <WindowList windows={windows} onFocus={onFocusWindow} onClose={onCloseWindow} />
              )}
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}