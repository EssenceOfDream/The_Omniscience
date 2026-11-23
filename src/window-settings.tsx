import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { installWindowChrome, invoke, mountApp, nodeRequest } from './tauri';
import './App.css';

type Settings = { label: string; title: string; alwaysOnTop: boolean };
declare global {
  interface Window {
    __OMNI_WINDOW_SETTINGS_TARGET__?: string;
  }
}

export default function WindowSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const label = window.__OMNI_WINDOW_SETTINGS_TARGET__;
    if (!label) {
      setError('Не выбрано окно для настройки.');
      return;
    }
    invoke<Settings>('get_program_window_settings', { label })
      .then(setSettings)
      .catch((reason) => setError(String(reason)));
  }, []);

  const setLayer = async (layer: 'top' | 'normal' | 'bottom') => {
    if (!settings) return;
    try {
      await invoke('set_program_window_layer', { label: settings.label, layer });
      setSettings({ ...settings, alwaysOnTop: layer === 'top' });
      setError('');
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <main className="shell">
      <header className="toolbar">
        <h1>{settings ? `Параметры: ${settings.title}` : 'Параметры окна'}</h1>
        <button onClick={() => void getCurrentWindow().close()}>×</button>
      </header>
      <section className="content">
        {error && <p className="error" role="alert">{error}</p>}
        <p>Положение окна относительно остальных окон</p>
        <div className="list">
          <button onClick={() => void setLayer('top')}>Поверх всех</button>
          <button onClick={() => void setLayer('normal')}>Обычное</button>
          <button onClick={() => void setLayer('bottom')}>Под остальными</button>
        </div>
        <hr />
        <div className="list">
          <button disabled={!settings} onClick={() => settings && void invoke('reload_program_window', {
            label: settings.label,
          }).catch((reason) => setError(String(reason)))}>Перезагрузить</button>
          <button disabled={!settings} onClick={() => settings && void invoke('open_program_devtools', {
            label: settings.label,
          }).catch((reason) => setError(String(reason)))}>Инструменты разработчика</button>
        </div>
      </section>
    </main>
  );
}

mountApp(<WindowSettings />);
installWindowChrome();
nodeRequest<Record<string, unknown>>('get-theme')
  .then((settings) => installWindowChrome(settings))
  .catch((error) => console.error('[window-settings] could not load theme:', error));
