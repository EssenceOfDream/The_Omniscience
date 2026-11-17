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
        bgcolor: 'rgba(0,0,0,0.28)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <Paper
        elevation={16}
        sx={{
          position: 'absolute',
          top: 16,
          right: 20,
          width: 292,
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'rgba(30,30,46,0.97)',
          border: '1px solid rgba(168,85,247,0.35)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
        }}
      >
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
          <Typography sx={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
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

        <Stack spacing={0.75}>
          {actions.map(({ id, label, Icon, danger }) => (
            <Button
              key={id}
              disabled={busy}
              onClick={() => execute(id)}
              startIcon={<Icon fontSize="small" />}
              sx={{
                justifyContent: 'flex-start',
                px: 1.25,
                py: 1,
                color: danger ? '#f38ba8' : '#f2f2f7',
                textTransform: 'none',
                fontSize: 13,
                '&:hover': {
                  bgcolor: danger ? 'rgba(243,139,168,0.14)' : 'rgba(168,85,247,0.14)',
                },
              }}
            >
              {label}
            </Button>
          ))}
        </Stack>

        {error && (
          <Typography role="alert" sx={{ mt: 1, color: '#f38ba8', fontSize: 11 }}>
            {error}
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
