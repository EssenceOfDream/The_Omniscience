import React, { useEffect, useState } from 'react';
import {
  Box, Button, IconButton, Paper, Stack, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import BedtimeIcon from '@mui/icons-material/Bedtime';
import LogoutIcon from '@mui/icons-material/Logout';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

const actions = [
  { id: 'logout', label: 'Выйти из аккаунта', Icon: LogoutIcon },
  { id: 'shutdown', label: 'Выключение', Icon: PowerSettingsNewIcon, danger: true },
  { id: 'restart', label: 'Перезагрузка', Icon: RestartAltIcon },
  { id: 'sleep', label: 'Спящий режим', Icon: BedtimeIcon },
];

function getApi() {
  return window.electron_topbar_API || null;
}

export default function PowerMenu() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = () => getApi()?.send?.('power-menu:close');

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const execute = async (action) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await getApi()?.invoke?.('power-menu:execute', { action });
      if (!result?.ok) {
        throw new Error(result?.error || 'Нет ответа от системы');
      }
    } catch (actionError) {
      setError(`Не удалось выполнить действие: ${actionError.message}`);
      setBusy(false);
    }
  };

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
        bgcolor: 'rgba(8,10,20,0.2)',
        backdropFilter: 'blur(14px)',
      }}
    >
      <Paper
        elevation={16}
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(760px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          p: { xs: 2, sm: 3 },
          borderRadius: 4,
          bgcolor: 'rgba(30,30,46,0.42)',
          backgroundImage: 'linear-gradient(145deg, rgba(255,255,255,0.1), rgba(30,30,46,0.34))',
          border: '1px solid rgba(210,190,255,0.28)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.34)',
          backdropFilter: 'blur(24px) saturate(1.35)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.35)',
        }}
      >
        <Stack direction="row" sx={{ mb: 2, alignItems: 'center' }}>
          <Typography sx={{ flex: 1, fontSize: 15, fontWeight: 600, letterSpacing: 0.2 }}>
            Питание
          </Typography>
          <IconButton
            aria-label="Закрыть меню"
            size="small"
            onClick={close}
            sx={{ color: 'rgba(255,255,255,0.65)' }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Stack direction="row" sx={{ flexWrap: 'wrap', justifyContent: 'center', gap: 1 }}>
          {actions.map(({ id, label, Icon, danger }) => (
            <Button
              key={id}
              disabled={busy}
              onClick={() => execute(id)}
              sx={{
                flex: '1 1 140px',
                maxWidth: 160,
                minHeight: 150,
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 1.5,
                px: 1.25,
                py: 1.5,
                color: danger ? '#f38ba8' : '#f2f2f7',
                textTransform: 'none',
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 3,
                border: '1px solid rgba(255,255,255,0.08)',
                backgroundColor: 'rgba(255,255,255,0.035)',
                transition: 'background-color 160ms ease, border-color 160ms ease, transform 160ms ease',
                '&:hover': {
                  bgcolor: danger ? 'rgba(243,139,168,0.13)' : 'rgba(168,85,247,0.14)',
                  borderColor: danger ? 'rgba(243,139,168,0.38)' : 'rgba(168,85,247,0.38)',
                  transform: 'translateY(-2px)',
                },
                '&:focus-visible': {
                  outline: '2px solid rgba(210,190,255,0.9)',
                  outlineOffset: 2,
                },
                '&:hover .power-menu-icon': {
                  transform: 'scale(1.06)',
                },
              }}
            >
              <Box
                component="span"
                className="power-menu-icon"
                sx={{
                  width: 76,
                  height: 76,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '50%',
                  color: danger ? '#ffc0d0' : '#e5d4ff',
                  background: danger
                    ? 'linear-gradient(145deg, rgba(243,139,168,0.28), rgba(243,139,168,0.08))'
                    : 'linear-gradient(145deg, rgba(168,85,247,0.3), rgba(110,80,180,0.1))',
                  border: danger
                    ? '1px solid rgba(243,139,168,0.38)'
                    : '1px solid rgba(200,170,255,0.34)',
                  boxShadow: 'inset 0 1px 5px rgba(255,255,255,0.12), 0 8px 24px rgba(0,0,0,0.16)',
                  transition: 'transform 160ms ease',
                }}
              >
                <Icon sx={{ fontSize: 36 }} />
              </Box>
              <Typography component="span" sx={{ lineHeight: 1.35, textAlign: 'center' }}>
                {label}
              </Typography>
            </Button>
          ))}
        </Stack>

        {error && (
          <Typography role="alert" sx={{ mt: 2, color: '#f38ba8', fontSize: 12, textAlign: 'center' }}>
            {error}
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
