import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, FormControl, FormControlLabel,
  LinearProgress, List, ListItem, ListItemText, MenuItem, Paper, Select,
  Stack, TextField, Typography, IconButton,
} from '@mui/material';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import UnarchiveIcon from '@mui/icons-material/Unarchive';

const UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

export default function VhdArchiver() {
  // --- Общие стейты ---
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const unsubRef = useRef(null);

  // --- Режим ---
  // 'pack' (сборка), 'unpack_frag' (из фрагментов в VHD), 'unpack_vhd' (из VHD в файлы)
  const [mode, setMode] = useState('pack');
  const [inputFile, setInputFile] = useState(null); // Для распаковки

  // --- Сборка ---
  const [rawPaths, setRawPaths] = useState([]);
  const [items, setItems] = useState(null);
  const [maxVal, setMaxVal] = useState(100);
  const [unit, setUnit] = useState('MB');
  const [baseName, setBaseName] = useState('');
  const [renameToTxt, setRenameToTxt] = useState(true);

  // --- Пути ---
  const [outputDir, setOutputDir] = useState('');
  const [outputDirError, setOutputDirError] = useState('');
  const [saveVhdPath, setSaveVhdPath] = useState('');

  const api = window.electron_omniArchiver_API;
  const maxSizeBytes = useMemo(() => maxVal * UNITS[unit], [maxVal, unit]);
  const limitTooSmall = maxSizeBytes < 1024 * 1024;

  const refresh = useCallback(async (paths) => {
    if (!paths.length) { setItems(null); return; }
    const r = await api.enumerate(paths);
    if (!r.ok) { setError(r.error); return; }
    setItems(r);
  }, [api]);

  useEffect(() => { if (mode === 'pack') refresh(rawPaths); }, [rawPaths, refresh, mode]);
  useEffect(() => () => { unsubRef.current?.(); }, []);

  // --- Обработка Drop ---
  const handleFileDrop = (path) => {
    setError(''); setInputFile(null); setSaveVhdPath(''); setOutputDir('');
    
    const lower = path.toLowerCase();
    if (lower.endsWith('.vhd')) {
      setMode('unpack_vhd');
      setInputFile(path);
      setBaseName(path.split(/[\\/]/).pop().replace(/\.vhd$/i, ''));
    } else if (lower.match(/\.zip\.001(\.txt)?$/)) {
      setMode('unpack_frag');
      setInputFile(path);
      const name = path.split(/[\\/]/).pop().replace(/\.vhd\.zip\.001(\.txt)?$/i, '');
      setBaseName(name);
      setSaveVhdPath(`${path.replace(/\.vhd\.zip\.001(\.txt)?$/i, '')}.vhd`);
    } else {
      setError('Неизвестный формат. Перетащите .zip.001.txt, .zip.001 или .vhd');
    }
  };

  const selectFiles = async (multiple, forUnpack = false) => {
    setError('');
    try {
      const selection = await api.selectFiles(multiple);
      if (!selection.ok) {
        if (selection.error !== 'cancelled') setError(selection.error || 'Не удалось выбрать файлы');
        return;
      }
      const paths = selection.paths || [];
      if (forUnpack) {
        if (paths[0]) handleFileDrop(paths[0]);
        return;
      }
      if (!paths.length) return;
      setMode('pack');
      setRawPaths((previous) => Array.from(new Set([...previous, ...paths])));
      if (!baseName) setBaseName(paths[0].split(/[\\/]/).pop().replace(/\.[^.]+$/, ''));
    } catch (selectionError) {
      setError(selectionError.message || String(selectionError));
    }
  };

  useEffect(() => api.onFilesDropped((paths) => {
    if (!Array.isArray(paths) || paths.length === 0) return;
    if (paths.length === 1) {
      handleFileDrop(paths[0]);
      return;
    }
    setMode('pack');
    setRawPaths((previous) => Array.from(new Set([...previous, ...paths])));
    if (!baseName) setBaseName(paths[0].split(/[\\/]/).pop().replace(/\.[^.]+$/, ''));
  }), [api, baseName]);

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => api.getPathForFile(f))
      .filter(Boolean);
      
    if (paths.length > 0) {
      if (paths.length === 1) {
        handleFileDrop(paths[0]);
      } else {
        setMode('pack');
        setRawPaths((prev) => Array.from(new Set([...prev, ...paths])));
        if (!baseName) setBaseName(paths[0].split(/[\\/]/).pop().replace(/\.[^.]+$/, ''));
      }
    }
  };

  // --- Действия ---
  const browseOutput = async () => {
    setOutputDirError('');
    const r = await api.selectOutputDir();
    if (r.ok) setOutputDir(r.path);
    else if (r.error !== 'cancelled') setOutputDirError(`Ошибка: ${r.error}`);
  };

  const browseSaveVhd = async () => {
    const r = await api.selectSaveVhd();
    if (r.ok) setSaveVhdPath(r.path);
  };

  const start = async () => {
    setError(''); setBusy(true); setProgress(0); setStage('');
    unsubRef.current?.();
    unsubRef.current = api.onProgress((p) => {
      setStage(p.stage || '');
      if (typeof p.progress === 'number') setProgress(p.progress);
      if (p.message) setMessage(p.message);
    });

    let r;
    if (mode === 'pack') {
      r = await api.start({ items, maxSizeBytes, outputDir, baseName, renameToTxt });
    } else if (mode === 'unpack_frag') {
      r = await api.unpackFragments({ firstFragment: inputFile, outputVhd: saveVhdPath });
    } else if (mode === 'unpack_vhd') {
      r = await api.unpackVhd({ vhdPath: inputFile, outputDir });
    }

    setBusy(false);
    if (!r.ok) setError(r.error);
    else {
      setMessage('Готово!');
      setInputFile(null);
      setRawPaths([]);
      setItems(null);
      setMode('pack');
    }
  };

  const cancel = () => api.cancel();

  // --- Валидация для кнопки ---
  let canStart = false;
  let actionText = '';
  if (mode === 'pack') {
    canStart = items?.files?.length > 0 && outputDir && baseName && !limitTooSmall && !busy;
    actionText = 'Собрать VHD и разбить';
  } else if (mode === 'unpack_frag') {
    canStart = !!inputFile && !!saveVhdPath && !busy;
    actionText = 'Собрать VHD из фрагментов';
  } else if (mode === 'unpack_vhd') {
    canStart = !!inputFile && !!outputDir && !busy;
    actionText = 'Распаковать файлы из VHD';
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Omni Archiver</Typography>

      {/* --- Drop Zone --- */}
      <Paper
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        sx={{
          p: 4, mb: 2, textAlign: 'center', border: '2px dashed',
          borderColor: dragOver ? 'primary.main' : 'divider',
          bgcolor: dragOver ? 'action.hover' : 'transparent',
        }}
      >
        <CloudUploadIcon sx={{ fontSize: 56, opacity: 0.6, mb: 1 }} />
        <Typography sx={{ fontWeight: 500 }}>Перетащите файлы или папки сюда</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          Поддерживается: файлы/папки (для упаковки), .zip.001.txt (сборка VHD), .vhd (распаковка)
        </Typography>
        <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
          <Button onClick={() => selectFiles(false, true)} startIcon={<FolderOpenIcon />} variant="outlined">
            Выбрать файл для распаковки
          </Button>
          <Button onClick={() => selectFiles(true)} startIcon={<UnarchiveIcon />} variant="outlined">
            Добавить данные для упаковки
          </Button>
          <Button startIcon={<CreateNewFolderIcon />} onClick={async () => {
            const r = await api.selectFolders();
            if (r.ok && r.paths?.length) {
              setMode('pack');
              setRawPaths(prev => Array.from(new Set([...prev, ...r.paths])));
            }
          }} variant="outlined">
            Добавить папку
          </Button>
        </Stack>
      </Paper>

      {/* --- UI для РЕЖИМА УПАКОВКИ --- */}
      {mode === 'pack' && (
        <>
          {items && (
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {items.files.length} файлов, {items.directories.length} папок, {(items.totalBytes / 1024 ** 2).toFixed(2)} MB
              </Typography>
              <List dense sx={{ maxHeight: 150, overflow: 'auto' }}>
                {rawPaths.map((p) => (
                  <ListItem key={p} secondaryAction={
                    <IconButton edge="end" onClick={() => setRawPaths(prev => prev.filter(x => x !== p))}>
                      <DeleteIcon />
                    </IconButton>
                  }>
                    <ListItemText primary={p} />
                  </ListItem>
                ))}
              </List>
            </Paper>
          )}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <TextField label="Макс. размер фрагмента" type="number" value={maxVal}
              onChange={(e) => setMaxVal(Math.max(0, Number(e.target.value)))}
              error={limitTooSmall} helperText={limitTooSmall ? 'Да скинь ты файл напрямую!' : ' '} sx={{ flex: 1 }} />
            <FormControl sx={{ width: 120 }}>
              <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
                {Object.keys(UNITS).map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="flex-start">
            <TextField fullWidth label="Путь сохранения" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="C:\..." />
            <Button variant="outlined" onClick={browseOutput} sx={{ mt: 1 }}>Обзор…</Button>
          </Stack>

          <TextField fullWidth label="Базовое имя" value={baseName} onChange={(e) => setBaseName(e.target.value)} sx={{ mb: 2 }} />
          
          <FormControlLabel control={<Checkbox checked={renameToTxt} onChange={(e) => setRenameToTxt(e.target.checked)} />}
            label="Переименовать в .txt (для ВК)" sx={{ mb: 2 }} />
        </>
      )}

      {/* --- UI для РЕЖИМА РАСПАКОВКИ ИЗ ФРАГМЕНТОВ --- */}
      {mode === 'unpack_frag' && (
        <Paper sx={{ p: 3, mb: 2, bgcolor: 'background.default' }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Сборка VHD из фрагментов</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>Выбран первый файл: <b>{inputFile.split(/[\\/]/).pop()}</b></Typography>
          
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField fullWidth label="Куда сохранить VHD" value={saveVhdPath} onChange={(e) => setSaveVhdPath(e.target.value)} />
            <Button variant="outlined" onClick={browseSaveVhd}>Выбрать...</Button>
          </Stack>
        </Paper>
      )}

      {/* --- UI для РЕЖИМА РАСПАКОВКИ VHD --- */}
      {mode === 'unpack_vhd' && (
        <Paper sx={{ p: 3, mb: 2, bgcolor: 'background.default' }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Распаковка файлов из VHD</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>Выбран VHD: <b>{inputFile.split(/[\\/]/).pop()}</b></Typography>
          
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField fullWidth label="Куда извлечь файлы" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} />
            <Button variant="outlined" onClick={browseOutput}>Выбрать...</Button>
          </Stack>
          <Alert severity="info" sx={{ mt: 2 }}>
            Для доступа к файлам внутри VHD потребуются права администратора.
          </Alert>
        </Paper>
      )}

      {/* --- Прогресс и Ошибки --- */}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {(busy || progress > 0) && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2">{message || stage || '…'}</Typography>
          <LinearProgress variant={progress ? 'determinate' : 'indeterminate'} value={progress} sx={{ my: 1 }} />
          {busy && <Button startIcon={<StopIcon />} onClick={cancel} size="small">Отмена</Button>}
        </Paper>
      )}

      <Button variant="contained" size="large" startIcon={<PlayArrowIcon />} onClick={start} disabled={!canStart} sx={{ mt: 2 }}>
        {busy ? <CircularProgress size={20} /> : actionText}
      </Button>
    </Box>
  );
}