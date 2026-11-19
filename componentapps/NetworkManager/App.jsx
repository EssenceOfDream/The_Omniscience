import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Snackbar,
  Stack,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
} from '@mui/material';
import { createTheme } from '@mui/material/styles';
import {
  Bluetooth as BluetoothIcon,
  BluetoothDisabled as BluetoothDisabledIcon,
  CheckCircle as ConnectedIcon,
  Devices as DevicesIcon,
  Lock as LockIcon,
  PowerSettingsNew as PowerIcon,
  Refresh as RefreshIcon,
  Router as RouterIcon,
  Search as SearchIcon,
  SignalWifi4Bar as SignalIcon,
  Wifi as WifiIcon,
  WifiOff as WifiOffIcon,
} from '@mui/icons-material';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#a78bfa' },
    secondary: { main: '#67e8f9' },
    success: { main: '#34d399' },
    background: { default: '#090d18', paper: '#121a2a' },
    text: { primary: '#f1f5f9', secondary: '#9aa9bd' },
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily: '"Segoe UI", Arial, sans-serif',
    h5: { fontWeight: 700, letterSpacing: '-0.03em' },
    h6: { fontWeight: 650 },
    button: { fontWeight: 600, textTransform: 'none' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { height: '100%' },
        body: { height: '100%', overflow: 'hidden' },
        '#root': { height: '100%' },
      },
    },
    MuiButton: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 12 } } },
  },
});

const cardSx = {
  minWidth: 0,
  minHeight: 300,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 3,
  borderColor: 'rgba(148, 163, 184, 0.15)',
  background: 'linear-gradient(145deg, rgba(20, 30, 48, 0.98), rgba(13, 20, 34, 0.98))',
  boxShadow: '0 18px 48px rgba(0, 0, 0, 0.22)',
};

function SectionHeading({ icon, title, description, action }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
      <Box
        sx={{
          width: 42,
          height: 42,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 2.5,
          color: 'primary.light',
          bgcolor: 'rgba(167, 139, 250, 0.12)',
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="h6" noWrap>{title}</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>{description}</Typography>
      </Box>
      {action}
    </Stack>
  );
}

function AppContent() {
  const [wifiNetworks, setWifiNetworks] = useState([]);
  const [wifiConnected, setWifiConnected] = useState(null);
  const [wifiLoading, setWifiLoading] = useState(false);
  const [wifiConnecting, setWifiConnecting] = useState(false);
  const [wifiQuery, setWifiQuery] = useState('');
  const [selectedWifiNetwork, setSelectedWifiNetwork] = useState(null);
  const [wifiPassword, setWifiPassword] = useState('');
  const [hotspotSsid, setHotspotSsid] = useState('');
  const [hotspotPassword, setHotspotPassword] = useState('');
  const [hotspotActive, setHotspotActive] = useState(false);

  const [btDevices, setBtDevices] = useState([]);
  const [btConnectedId, setBtConnectedId] = useState(null);
  const [btScanning, setBtScanning] = useState(false);
  const [btConnecting, setBtConnecting] = useState(false);

  const [error, setError] = useState('');
  const [snackbarOpen, setSnackbarOpen] = useState(false);

  const showError = useCallback((message) => {
    setError(message || 'Произошла неизвестная ошибка');
    setSnackbarOpen(true);
  }, []);

  const scanWifi = useCallback(async () => {
    setWifiLoading(true);
    try {
      const result = await window.electron_network_API.scanWifi();
      if (result.success) setWifiNetworks(result.data);
      else showError(result.error);
    } catch (scanError) {
      showError(scanError.message);
    } finally {
      setWifiLoading(false);
    }
  }, [showError]);

  const visibleNetworks = useMemo(() => {
    const query = wifiQuery.trim().toLocaleLowerCase('ru');
    if (!query) return wifiNetworks;
    return wifiNetworks.filter((network) =>
      (network.displaySsid || network.ssid || '').toLocaleLowerCase('ru').includes(query));
  }, [wifiNetworks, wifiQuery]);

  const connectWifi = async (ssid, password = '') => {
    setWifiConnecting(true);
    try {
      const result = await window.electron_network_API.connectWifi(ssid, password);
      if (!result.success) {
        showError(result.error);
        return false;
      }
      setWifiConnected(ssid);
      await scanWifi();
      return true;
    } catch (connectError) {
      showError(connectError.message);
      return false;
    } finally {
      setWifiConnecting(false);
    }
  };

  const requestWifiConnection = (network) => {
    if (wifiConnected === network.ssid) return;
    const isProtected = network.security && !/open/i.test(network.security);
    if (isProtected) {
      setWifiPassword('');
      setSelectedWifiNetwork(network);
      return;
    }
    connectWifi(network.ssid);
  };

  const submitWifiPassword = async (event) => {
    event.preventDefault();
    if (!selectedWifiNetwork) return;
    const connected = await connectWifi(selectedWifiNetwork.ssid, wifiPassword);
    if (connected) setSelectedWifiNetwork(null);
  };

  const disconnectWifi = async () => {
    try {
      const result = await window.electron_network_API.disconnectWifi();
      if (result.success) setWifiConnected(null);
      else showError(result.error);
    } catch (disconnectError) {
      showError(disconnectError.message);
    }
  };

  const toggleHotspot = async () => {
    try {
      if (hotspotActive) {
        const result = await window.electron_network_API.stopHotspot();
        if (result.success) setHotspotActive(false);
        else showError(result.error);
        return;
      }
      if (!hotspotSsid.trim() || hotspotPassword.length < 8) {
        showError('Укажите имя сети и пароль длиной не менее 8 символов');
        return;
      }
      const result = await window.electron_network_API.startHotspot(hotspotSsid, hotspotPassword);
      if (result.success) setHotspotActive(true);
      else showError(result.error);
    } catch (hotspotError) {
      showError(hotspotError.message);
    }
  };

  const startBtScan = async () => {
    setBtScanning(true);
    setBtDevices([]);
    try {
      const result = await window.electron_network_API.startBluetoothScan();
      if (!result.success) {
        showError(result.error);
        setBtScanning(false);
      }
    } catch (scanError) {
      showError(scanError.message);
      setBtScanning(false);
    }
  };

  const connectBt = async (deviceId) => {
    setBtConnecting(true);
    try {
      const result = await window.electron_network_API.connectBluetooth(deviceId);
      if (result.success) setBtConnectedId(deviceId);
      else showError(result.error);
    } catch (connectError) {
      showError(connectError.message);
    } finally {
      setBtConnecting(false);
    }
  };

  const disconnectBt = async () => {
    try {
      const result = await window.electron_network_API.disconnectBluetooth();
      if (result.success) setBtConnectedId(null);
      else showError(result.error);
    } catch (disconnectError) {
      showError(disconnectError.message);
    }
  };

  useEffect(() => {
    scanWifi();
    const unsubscribeFound = window.electron_network_API.onBluetoothDeviceFound((device) => {
      setBtDevices((previous) => (
        previous.some((item) => item.id === device.id)
          ? previous
          : [...previous, device]
      ));
    });
    const unsubscribeFinished = window.electron_network_API.onBluetoothScanFinished(() => {
      setBtScanning(false);
    });
    return () => {
      unsubscribeFound();
      unsubscribeFinished();
    };
  }, [scanWifi]);

  return (
    <Box
      sx={{
        height: '100%',
        overflow: 'auto',
        px: { xs: 2, sm: 3, lg: 4 },
        py: { xs: 2, sm: 3 },
        background:
          'radial-gradient(ellipse at 8% 0%, rgba(124, 58, 237, 0.18), transparent 34%), radial-gradient(ellipse at 100% 20%, rgba(34, 211, 238, 0.10), transparent 32%), #090d18',
      }}
    >
      <Box sx={{ maxWidth: 1500, mx: 'auto' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Stack direction="row" spacing={2} alignItems="center">
            <Box
              sx={{
                width: 56,
                height: 56,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 3,
                color: '#e9ddff',
                background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                boxShadow: '0 10px 28px rgba(124, 58, 237, 0.28)',
              }}
            >
              <RouterIcon sx={{ fontSize: 30 }} />
            </Box>
            <Box>
              <Typography variant="h5">Сеть и устройства</Typography>
              <Typography color="text.secondary">
                Управление Wi-Fi, точкой доступа и Bluetooth
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              icon={wifiConnected ? <WifiIcon /> : <WifiOffIcon />}
              label={wifiConnected ? `Wi-Fi · ${wifiConnected}` : 'Wi-Fi не подключён'}
              color={wifiConnected ? 'success' : 'default'}
              variant="outlined"
            />
            <Chip
              icon={btConnectedId ? <BluetoothIcon /> : <BluetoothDisabledIcon />}
              label={btConnectedId ? 'Bluetooth подключён' : 'Bluetooth отключён'}
              color={btConnectedId ? 'success' : 'default'}
              variant="outlined"
            />
          </Stack>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
            alignItems: 'stretch',
          }}
        >
          <Card variant="outlined" sx={{ ...cardSx, minHeight: 420 }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', flex: 1, p: { xs: 2, sm: 2.5 } }}>
              <SectionHeading
                icon={<WifiIcon />}
                title="Доступные сети"
                description={`${wifiNetworks.length} ${wifiNetworks.length === 1 ? 'сеть' : 'сетей'} поблизости`}
                action={(
                  <Tooltip title="Обновить список">
                    <span>
                      <IconButton onClick={scanWifi} disabled={wifiLoading} color="primary" aria-label="Обновить Wi-Fi">
                        {wifiLoading ? <CircularProgress size={20} /> : <RefreshIcon />}
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
              />
              <TextField
                size="small"
                value={wifiQuery}
                onChange={(event) => setWifiQuery(event.target.value)}
                placeholder="Поиск сети"
                inputProps={{ 'aria-label': 'Поиск сети Wi-Fi' }}
                InputProps={{ startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> }}
                sx={{ mb: 1.5 }}
              />
              {wifiLoading && <LinearProgress sx={{ mb: 1, borderRadius: 2 }} />}
              <Stack spacing={0.75} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
                {visibleNetworks.map((network, index) => {
                  const ssid = network.displaySsid || network.ssid || 'Скрытая сеть';
                  const quality = Math.max(0, Math.min(100, Number(network.quality) || 0));
                  const protectedNetwork = network.security && !/open/i.test(network.security);
                  return (
                    <Box
                      key={network.bssid || `${ssid}-${index}`}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        p: 1.25,
                        border: '1px solid rgba(148, 163, 184, 0.10)',
                        borderRadius: 2.5,
                        bgcolor: 'rgba(255,255,255,0.025)',
                        transition: 'background .18s ease, border-color .18s ease',
                        '&:hover': { bgcolor: 'rgba(167,139,250,0.07)', borderColor: 'rgba(167,139,250,.28)' },
                      }}
                    >
                      <WifiIcon color={wifiConnected === network.ssid ? 'success' : 'primary'} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={650} noWrap title={ssid}>{ssid}</Typography>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.4 }}>
                          {protectedNetwork && <LockIcon sx={{ fontSize: 13, color: 'text.secondary' }} />}
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {protectedNetwork ? network.security : 'Открытая сеть'}
                          </Typography>
                          <SignalIcon sx={{ ml: 'auto', fontSize: 15, color: 'text.secondary' }} />
                          <Typography variant="caption" color="text.secondary">{quality}%</Typography>
                        </Stack>
                      </Box>
                      <Button
                        size="small"
                        variant={wifiConnected === network.ssid ? 'text' : 'outlined'}
                        color={wifiConnected === network.ssid ? 'success' : 'primary'}
                        disabled={wifiConnecting || wifiConnected === network.ssid || !network.ssid}
                        onClick={() => requestWifiConnection(network)}
                      >
                        {wifiConnected === network.ssid ? 'Подключено' : 'Подключить'}
                      </Button>
                    </Box>
                  );
                })}
                {!wifiLoading && visibleNetworks.length === 0 && (
                  <Typography color="text.secondary" variant="body2" sx={{ py: 4, textAlign: 'center' }}>
                    {wifiQuery ? 'Сети не найдены' : 'Нажмите обновить, чтобы найти сети'}
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ ...cardSx, minHeight: 420 }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', flex: 1, p: { xs: 2, sm: 2.5 } }}>
              <SectionHeading
                icon={<BluetoothIcon />}
                title="Bluetooth"
                description="Поиск ближайших устройств"
                action={(
                  <Button
                    variant="contained"
                    startIcon={btScanning ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
                    onClick={startBtScan}
                    disabled={btScanning}
                  >
                    {btScanning ? 'Поиск…' : 'Найти'}
                  </Button>
                )}
              />
              <Alert severity="info" icon={<DevicesIcon />} sx={{ mb: 1.5, py: 0 }}>
                Подключение доступно для устройств с профилем Bluetooth SPP.
              </Alert>
              <Stack spacing={0.75} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 0.5 }}>
                {btDevices.map((device) => {
                  const isConnected = btConnectedId === device.id;
                  return (
                    <Box
                      key={device.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        p: 1.25,
                        border: '1px solid rgba(148, 163, 184, 0.10)',
                        borderRadius: 2.5,
                        bgcolor: isConnected ? 'rgba(52, 211, 153, 0.07)' : 'rgba(255,255,255,0.025)',
                      }}
                    >
                      <BluetoothIcon color={isConnected ? 'success' : 'primary'} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={650} noWrap title={device.name}>
                          {device.name || 'Неизвестное устройство'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>{device.address}</Typography>
                      </Box>
                      <Button
                        size="small"
                        variant={isConnected ? 'text' : 'outlined'}
                        color={isConnected ? 'success' : 'primary'}
                        disabled={btConnecting || (btConnectedId !== null && !isConnected)}
                        onClick={() => (isConnected ? disconnectBt() : connectBt(device.id))}
                      >
                        {isConnected ? 'Отключить' : 'Подключить'}
                      </Button>
                    </Box>
                  );
                })}
                {btScanning && (
                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ py: 3 }}>
                    <CircularProgress size={18} />
                    <Typography variant="body2" color="text.secondary">Ищем устройства…</Typography>
                  </Stack>
                )}
                {!btScanning && btDevices.length === 0 && (
                  <Typography color="text.secondary" variant="body2" sx={{ py: 4, textAlign: 'center' }}>
                    Нажмите «Найти», чтобы выполнить поиск.
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={cardSx}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', flex: 1, p: { xs: 2, sm: 2.5 } }}>
              <SectionHeading
                icon={<PowerIcon />}
                title="Точка доступа"
                description="Раздача интернета по Wi-Fi"
                action={hotspotActive && <Chip size="small" color="success" label="Активна" />}
              />
              <Stack spacing={1.5} sx={{ mt: 0.5 }}>
                <TextField
                  label="Имя сети"
                  size="small"
                  value={hotspotSsid}
                  onChange={(event) => setHotspotSsid(event.target.value)}
                  disabled={hotspotActive}
                  inputProps={{ maxLength: 32 }}
                />
                <TextField
                  label="Пароль"
                  type="password"
                  size="small"
                  value={hotspotPassword}
                  onChange={(event) => setHotspotPassword(event.target.value)}
                  disabled={hotspotActive}
                  helperText={!hotspotActive && 'Не менее 8 символов'}
                  inputProps={{ minLength: 8, maxLength: 63 }}
                />
                <Button
                  variant="contained"
                  color={hotspotActive ? 'error' : 'primary'}
                  startIcon={<PowerIcon />}
                  onClick={toggleHotspot}
                  sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                >
                  {hotspotActive ? 'Остановить раздачу' : 'Запустить точку доступа'}
                </Button>
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={cardSx}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', flex: 1, p: { xs: 2, sm: 2.5 } }}>
              <SectionHeading
                icon={btConnectedId ? <BluetoothIcon /> : <DevicesIcon />}
                title="Подключения"
                description="Текущее состояние устройств"
              />
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 1.75,
                    borderRadius: 2.5,
                    bgcolor: wifiConnected ? 'rgba(52, 211, 153, 0.08)' : 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(148, 163, 184, 0.10)',
                  }}
                >
                  {wifiConnected ? <ConnectedIcon color="success" /> : <WifiOffIcon color="disabled" />}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={650}>Wi-Fi</Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {wifiConnected || 'Не подключено'}
                    </Typography>
                  </Box>
                  {wifiConnected && (
                    <Button size="small" color="error" onClick={disconnectWifi}>Отключить</Button>
                  )}
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 1.75,
                    borderRadius: 2.5,
                    bgcolor: btConnectedId ? 'rgba(52, 211, 153, 0.08)' : 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(148, 163, 184, 0.10)',
                  }}
                >
                  {btConnectedId ? <ConnectedIcon color="success" /> : <BluetoothDisabledIcon color="disabled" />}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={650}>Bluetooth</Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {btConnectedId
                        ? btDevices.find((device) => device.id === btConnectedId)?.name || btConnectedId
                        : 'Не подключено'}
                    </Typography>
                  </Box>
                  {btConnectedId && (
                    <Button size="small" color="error" onClick={disconnectBt}>Отключить</Button>
                  )}
                </Box>
              </Stack>
              <Divider sx={{ my: 2 }} />
              <Typography variant="caption" color="text.secondary">
                Сканирование Bluetooth ищет устройства поблизости; для подключения устройство должно поддерживать SPP.
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </Box>

      <Dialog
        open={Boolean(selectedWifiNetwork)}
        onClose={() => setSelectedWifiNetwork(null)}
        fullWidth
        maxWidth="xs"
      >
        <Box component="form" onSubmit={submitWifiPassword}>
          <DialogTitle>Подключение к Wi-Fi</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Введите пароль сети «{selectedWifiNetwork?.displaySsid || selectedWifiNetwork?.ssid}».
            </Typography>
            <TextField
              autoFocus
              fullWidth
              label="Пароль сети"
              type="password"
              value={wifiPassword}
              onChange={(event) => setWifiPassword(event.target.value)}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setSelectedWifiNetwork(null)} color="inherit">Отмена</Button>
            <Button type="submit" variant="contained" disabled={wifiConnecting || !wifiPassword}>
              {wifiConnecting ? 'Подключение…' : 'Подключить'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={6000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbarOpen(false)} severity="error" variant="filled" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppContent />
    </ThemeProvider>
  );
}
