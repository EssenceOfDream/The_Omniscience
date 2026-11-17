import React, { useMemo, useState } from 'react';
import {
  Alert, Box, InputAdornment, Paper, TextField, Typography,
} from '@mui/material';
import ComputerIcon from '@mui/icons-material/Computer';
import DevicesIcon from '@mui/icons-material/Devices';
import PublicIcon from '@mui/icons-material/Public';
import BrushIcon from '@mui/icons-material/Brush';
import AppsIcon from '@mui/icons-material/Apps';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import AccessibilityNewIcon from '@mui/icons-material/AccessibilityNew';
import SearchIcon from '@mui/icons-material/Search';
import LockIcon from '@mui/icons-material/Lock';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';

const categories = [
  { id: 'system', title: 'Система', description: 'Экран, звук, уведомления, питание', Icon: ComputerIcon },
  { id: 'devices', title: 'Устройства', description: 'Принтеры, мышь и другое оборудование', Icon: DevicesIcon },
  { id: 'network', title: 'Сеть и Интернет', description: 'Подключения, общий доступ, VPN', Icon: PublicIcon },
  { id: 'personalization', title: 'Персонализация', description: 'Фон, экран блокировки, цвета', Icon: BrushIcon },
  { id: 'apps', title: 'Приложения', description: 'Удаление и настройка программ', Icon: AppsIcon },
  { id: 'accounts', title: 'Учетные записи', description: 'Пользователи и параметры входа', Icon: AccountCircleIcon },
  { id: 'timeLanguage', title: 'Время и язык', description: 'Регион, язык и дата', Icon: AccessTimeIcon },
  { id: 'gaming', title: 'Игры', description: 'Игровые устройства и контроллеры', Icon: SportsEsportsIcon },
  { id: 'accessibility', title: 'Специальные возможности', description: 'Экранный диктор и настройки доступности', Icon: AccessibilityNewIcon },
  { id: 'search', title: 'Поиск', description: 'Параметры индексирования файлов', Icon: SearchIcon },
  { id: 'privacy', title: 'Конфиденциальность', description: 'Параметры безопасности и веб-данных', Icon: LockIcon },
  { id: 'update', title: 'Обновление и безопасность', description: 'Центр обновления Windows', Icon: SystemUpdateAltIcon },
];

export default function SettingsHome() {
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const visibleCategories = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ru');
    if (!normalizedQuery) return categories;
    return categories.filter(({ title, description }) =>
      `${title} ${description}`.toLocaleLowerCase('ru').includes(normalizedQuery));
  }, [query]);

  const openCategory = async (id) => {
    setError('');
    try {
      const result = await window.electron_topbar_API?.invoke('settings:open-category', {
        category: id,
      });
      if (!result?.ok) throw new Error(result?.error || 'Нет ответа от Windows');
    } catch (openError) {
      setError(`Не удалось открыть раздел: ${openError.message}`);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', color: '#171717', bgcolor: '#fff' }}>
      <Box
        sx={{
          minHeight: 208,
          px: { xs: 3, md: 6 },
          py: 3,
          bgcolor: '#f3f3f3',
          borderBottom: '1px solid #e6e6e6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <AccountCircleIcon sx={{ color: '#0078d4', fontSize: 44 }} />
          <Box>
            <Typography sx={{ fontSize: 20, fontWeight: 400 }}>Параметры</Typography>
            <Typography sx={{ mt: 1.5, color: '#666', fontSize: 14 }}>
              Локальная учетная запись
            </Typography>
            <Typography
              component="button"
              onClick={() => openCategory('accounts')}
              sx={{
                mt: 0.25,
                p: 0,
                border: 0,
                bgcolor: 'transparent',
                color: '#0078d4',
                font: 'inherit',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Параметры учетной записи
            </Typography>
          </Box>
        </Box>
        <Paper
          component="button"
          elevation={0}
          onClick={() => openCategory('update')}
          sx={{
            width: 250,
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 0.75,
            border: '1px solid transparent',
            bgcolor: 'transparent',
            textAlign: 'left',
            cursor: 'pointer',
            '&:hover': { borderColor: '#cfcfcf', bgcolor: '#fff' },
          }}
        >
          <SystemUpdateAltIcon sx={{ color: '#171717', fontSize: 32 }} />
          <Typography sx={{ color: '#171717', fontSize: 15 }}>
            Центр обновления Windows
          </Typography>
          <Typography sx={{ color: '#666', fontSize: 12 }}>
            Проверить наличие обновлений
          </Typography>
        </Paper>
      </Box>

      <Box sx={{ maxWidth: 1050, mx: 'auto', px: { xs: 2, sm: 4 }, pb: 5 }}>
        <TextField
          fullWidth
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти параметр"
          sx={{
            maxWidth: 340,
            display: 'block',
            mx: 'auto',
            mt: 4,
            mb: 5,
            '& .MuiOutlinedInput-root': { borderRadius: 0 },
          }}
          slotProps={{
            htmlInput: { 'aria-label': 'Найти параметр' },
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <SearchIcon sx={{ color: '#888', fontSize: 20 }} />
                </InputAdornment>
              ),
            },
          }}
        />

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              md: 'repeat(4, minmax(0, 1fr))',
              lg: 'repeat(4, minmax(0, 1fr))',
            },
            columnGap: 2,
            rowGap: 2.5,
          }}
        >
          {visibleCategories.map(({ id, title, description, Icon }) => (
            <Paper
              key={id}
              component="button"
              elevation={0}
              onClick={() => openCategory(id)}
              sx={{
                minHeight: 92,
                p: 1.5,
                display: 'grid',
                gridTemplateColumns: '38px minmax(0, 1fr)',
                alignItems: 'start',
                gap: 1.25,
                border: '1px solid transparent',
                bgcolor: 'transparent',
                textAlign: 'left',
                cursor: 'pointer',
                '&:hover': { borderColor: '#d8eaf7', bgcolor: '#f8fbfd' },
                '&:focus-visible': { outline: '2px solid #0078d4', outlineOffset: 1 },
              }}
            >
              <Icon sx={{ mt: 0.1, color: '#0078d4', fontSize: 32 }} />
              <Box>
                <Typography sx={{ color: '#171717', fontSize: 14, lineHeight: 1.4 }}>
                  {title}
                </Typography>
                <Typography sx={{ mt: 0.5, color: '#666', fontSize: 12, lineHeight: 1.45 }}>
                  {description}
                </Typography>
              </Box>
            </Paper>
          ))}
          {!visibleCategories.length && (
            <Typography sx={{ gridColumn: '1 / -1', color: '#666', textAlign: 'center' }}>
              Разделы не найдены
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
