import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import DeveloperModeIcon from '@mui/icons-material/DeveloperMode';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

const categoryLabels = {
  componentapps: 'Компонент',
  extensions: 'Расширение',
  main: 'Хост',
  project: 'Проект',
  renderer: 'Интерфейс',
  webapps: 'Веб-приложение',
};

const changeLabels = {
  added: 'добавлен',
  changed: 'изменён',
  deleted: 'удалён',
};

function getApi() {
  return window.electron_topbar_API;
}

export default function DevelopmentHostMenu() {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [runningAction, setRunningAction] = useState(null);
  const api = getApi();
  const changed = Array.isArray(status?.changed) ? status.changed : [];
  const busy = Boolean(status?.busy || runningAction);
  const statusTone = status?.lastError ? 'error' : status?.busy ? 'info'
    : changed.length ? 'warning' : 'success';

  const close = () => api?.send('development-host:close');

  useEffect(() => {
    if (!api) {
      setLoadError('API меню состояния недоступен');
      return undefined;
    }

    const unsubscribe = api.on('development-host:status', setStatus);
    api.invoke('development-host:get-status')
      .then(setStatus)
      .catch((error) => setLoadError(error.message));

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      unsubscribe();
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const runAction = async (action) => {
    if (!api || runningAction) return;
    setRunningAction(action);
    setActionError('');
    try {
      const result = await api.invoke('development-host:action', { action });
      if (!result?.ok) throw new Error(result?.error || 'Действие не выполнено');
      if (action !== 'close') {
        setStatus(await api.invoke('development-host:get-status'));
      }
    } catch (error) {
      setActionError(action === 'close' && error.message === 'Неизвестное действие хоста'
        ? 'Запущенная версия не поддерживает закрытие из меню. Полностью закройте Omniscience через трей и запустите заново.'
        : error.message);
    } finally {
      setRunningAction(null);
    }
  };

  const statusLabel = status?.busy
    || (changed.length ? `Неприменённых изменений: ${changed.length}` : 'Изменений нет');
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
        boxSizing: 'border-box',
        bgcolor: 'rgba(0,0,0,0.18)',
      }}
    >
      <Paper
        role="dialog"
        aria-modal="true"
        aria-label="Состояние Omniscience"
        onClick={(event) => event.stopPropagation()}
        elevation={18}
        sx={{
          width: 'min(560px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          p: { xs: 2, sm: 3 },
          borderRadius: 3.5,
          bgcolor: 'background.paper',
          backgroundImage: (theme) => (
            `linear-gradient(145deg, ${theme.palette.primary.light}, ${theme.palette.background.paper})`
          ),
          border: (theme) => `1px solid ${theme.palette.primary.light}`,
          boxShadow: '0 24px 68px rgba(0,0,0,0.3)',
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box sx={{
            width: 38,
            height: 38,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 2,
            bgcolor: 'primary.dark',
            border: (theme) => `1px solid ${theme.palette.primary.light}`,
            color: 'primary.light',
          }}>
            <DeveloperModeIcon fontSize="small" />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 16, fontWeight: 700 }}>
              Omniscience Development Host
            </Typography>
            <Typography sx={{ mt: 0.3, color: 'text.secondary', fontSize: 11 }}>
              Состояние запущенного приложения и исходников
            </Typography>
          </Box>
          <IconButton
            aria-label="Закрыть меню"
            size="small"
            onClick={close}
            sx={{ color: 'text.secondary' }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            mt: 2,
            px: 1.25,
            py: 1,
            gap: 1.5,
            borderRadius: 2,
            bgcolor: 'primary.dark',
            border: (theme) => `1px solid ${theme.palette.divider}`,
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1} sx={{ flex: 1, minWidth: 0 }}>
            {status ? (
              <Box sx={(theme) => ({
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: alpha(theme.palette[statusTone].main, 0.78),
              })} />
            ) : <CircularProgress size={12} />}
            <Typography sx={(theme) => ({
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 12,
              color: alpha(theme.palette[statusTone].main, 0.92),
            })}>
              {status ? statusLabel : 'Получение состояния...'}
            </Typography>
          </Stack>
          <Typography sx={{
            flexShrink: 0,
            px: 0.8,
            py: 0.4,
            borderRadius: 1,
            bgcolor: 'rgba(0,0,0,0.12)',
            fontFamily: 'monospace',
            fontSize: 10,
            color: 'text.secondary',
          }}>
            PID {status?.childPid ?? '—'}
          </Typography>
        </Stack>

        {loadError && (
          <Alert severity="error" sx={(theme) => ({
            mt: 1.5,
            bgcolor: theme.palette.background.paper,
            color: 'text.primary',
            border: `1px solid ${alpha(theme.palette.error.main, 0.42)}`,
            '& .MuiAlert-icon': { color: alpha(theme.palette.error.main, 0.82) },
          })}>
            {loadError}
          </Alert>
        )}
        {status?.lastError && (
          <Alert severity="error" sx={(theme) => ({
            mt: 1.5,
            whiteSpace: 'pre-wrap',
            bgcolor: theme.palette.background.paper,
            color: 'text.primary',
            border: `1px solid ${alpha(theme.palette.error.main, 0.42)}`,
            '& .MuiAlert-icon': { color: alpha(theme.palette.error.main, 0.82) },
          })}>
            {status.lastError}
          </Alert>
        )}
        {actionError && (
          <Alert severity="error" sx={(theme) => ({
            mt: 1.5,
            bgcolor: theme.palette.background.paper,
            color: 'text.primary',
            border: `1px solid ${alpha(theme.palette.error.main, 0.42)}`,
            '& .MuiAlert-icon': { color: alpha(theme.palette.error.main, 0.82) },
          })} onClose={() => setActionError('')}>
            {actionError}
          </Alert>
        )}

        <Stack direction="row" alignItems="center" sx={{ mt: 2, mb: 1 }}>
          <Typography sx={{ flex: 1, fontSize: 12, fontWeight: 700 }}>
            Изменённые файлы
          </Typography>
          <Chip
            size="small"
            label={changed.length}
            sx={{
              height: 22,
              bgcolor: 'primary.dark',
              color: 'text.primary',
              border: (theme) => `1px solid ${theme.palette.divider}`,
              fontSize: 10,
            }}
          />
        </Stack>

        <Box
          sx={{
            minHeight: 64,
            maxHeight: '24vh',
            overflowY: 'auto',
            bgcolor: 'rgba(0,0,0,0.12)',
            border: (theme) => `1px solid ${theme.palette.divider}`,
            borderRadius: 2,
          }}
        >
          {changed.length ? changed.map((item) => (
            <Stack
              key={item.path}
              direction="row"
              spacing={1.25}
              alignItems="baseline"
              sx={{
                px: 1.25,
                py: 0.85,
                borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                '&:last-child': { borderBottom: 0 },
              }}
            >
              <Typography
                title={item.category}
                sx={{ width: 100, flexShrink: 0, color: 'primary.light', fontSize: 10 }}
              >
                {categoryLabels[item.category] || item.category}
              </Typography>
              <Typography
                title={`${item.path} · ${changeLabels[item.type] || item.type}`}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  overflowWrap: 'anywhere',
                  color: 'text.primary',
                  fontSize: 11,
                }}
              >
                {item.path}
              </Typography>
              <Typography sx={{ flexShrink: 0, color: 'text.secondary', fontSize: 10 }}>
                {changeLabels[item.type] || item.type}
              </Typography>
            </Stack>
          )) : (
            <Typography sx={{ p: 2, color: 'text.secondary', fontSize: 11 }}>
              {status ? 'Нет неприменённых изменений' : 'Список пока недоступен'}
            </Typography>
          )}
        </Box>

        <Divider sx={{ my: 1.75, borderColor: 'divider' }} />
        <Typography sx={{ mb: 1, fontSize: 12, fontWeight: 700 }}>
          Действия
        </Typography>
        <Stack spacing={0.75}>
          <Button
            variant="contained"
            startIcon={runningAction === 'apply' ? <CircularProgress size={14} /> : <PlayArrowIcon />}
            disabled={busy || changed.length === 0}
            onClick={() => runAction('apply')}
            sx={{
              justifyContent: 'flex-start',
              minHeight: 42,
              px: 1.5,
              textTransform: 'none',
              color: 'text.primary',
              bgcolor: 'primary.dark',
              borderRadius: 2,
              border: (theme) => `1px solid ${theme.palette.primary.light}`,
              '&:hover': { bgcolor: 'primary.main' },
            }}
          >
            Пересобрать и применить
          </Button>
          <Button
            startIcon={<RefreshIcon />}
            disabled={busy}
            onClick={() => runAction('reload')}
            sx={{
              justifyContent: 'flex-start',
              minHeight: 42,
              px: 1.5,
              textTransform: 'none',
              color: 'primary.light',
              border: (theme) => `1px solid ${theme.palette.divider}`,
              borderRadius: 2,
              bgcolor: 'rgba(0,0,0,0.08)',
              '&:hover': { bgcolor: 'primary.dark', borderColor: 'primary.light' },
            }}
          >
            Перезагрузить интерфейсы
          </Button>
          <Button
            startIcon={<RestartAltIcon />}
            disabled={busy}
            onClick={() => runAction('restart')}
            sx={{
              justifyContent: 'flex-start',
              minHeight: 42,
              px: 1.5,
              textTransform: 'none',
              color: 'primary.light',
              border: (theme) => `1px solid ${theme.palette.divider}`,
              borderRadius: 2,
              bgcolor: 'rgba(0,0,0,0.08)',
              '&:hover': { bgcolor: 'primary.dark', borderColor: 'primary.light' },
            }}
          >
            Полный перезапуск
          </Button>
          <Button
            startIcon={<FolderOpenIcon />}
            disabled={Boolean(runningAction)}
            onClick={() => runAction('open-project')}
            sx={{
              justifyContent: 'flex-start',
              minHeight: 42,
              px: 1.5,
              textTransform: 'none',
              color: 'primary.light',
              border: (theme) => `1px solid ${theme.palette.divider}`,
              borderRadius: 2,
              bgcolor: 'rgba(0,0,0,0.08)',
              '&:hover': { bgcolor: 'primary.dark', borderColor: 'primary.light' },
            }}
          >
            Открыть папку проекта
          </Button>
          <Button
            startIcon={runningAction === 'close'
              ? <CircularProgress size={14} />
              : <PowerSettingsNewIcon />}
            disabled={Boolean(runningAction)}
            onClick={() => runAction('close')}
            sx={(theme) => ({
              justifyContent: 'flex-start',
              minHeight: 42,
              px: 1.5,
              textTransform: 'none',
              color: alpha(theme.palette.error.main, 0.9),
              bgcolor: alpha(theme.palette.error.main, 0.12),
              border: `1px solid ${alpha(theme.palette.error.main, 0.36)}`,
              borderRadius: 2,
              '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.2) },
            })}
          >
            Закрыть Omniscience
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
