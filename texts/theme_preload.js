(() => {
  const href = window.location.href;
  if (!href.startsWith('chrome-extension://') && !href.startsWith('devtools://')) return;

  if (href.startsWith('chrome-extension://')) {
    contextBridge.exposeInMainWorld('electron_theme_API', {
      updateSetting: (field, value) =>
        ipcRenderer.send('theme:extension-update', { field, value }),
    });
  }

  const { webFrame } = require('electron');
  const themeContent = __OMNI_THEME_CONTENT__;
  let contentInjected = false;
  let updateReceived = false;
  let applyQueue = Promise.resolve();

  const applyTheme = (theme) => {
    if (!theme || typeof theme !== 'object') return;
    applyQueue = applyQueue.then(async () => {
      const colors = theme.colors || {};
      const settings = {
        enabled: theme.enabled !== false,
        maxR: colors.maxR ?? 128,
        maxG: colors.maxG ?? 0,
        maxB: colors.maxB ?? 128,
        targetAlpha: colors.targetAlpha ?? 0.25,
        textBrightness: colors.textBrightness ?? 255,
        blurShadow: colors.blurShadow ?? 8,
        shadowColor: colors.shadowColor ?? '#ff00ff',
      };
      const script = [
        '(function () {',
        '  const href = window.location.href;',
        "  if (!href.startsWith('chrome-extension://') && !href.startsWith('devtools://')) return;",
        `  const settings = ${JSON.stringify(settings)};`,
        "  try { localStorage.setItem('__omni_settings__', JSON.stringify(settings)); } catch (_) {}",
        contentInjected ? '' : themeContent,
        "  window.dispatchEvent(new CustomEvent('__omni_settings_updated__', { detail: settings }));",
        '})();',
      ].join('\n');

      try {
        await webFrame.executeJavaScript(script);
        contentInjected = true;
      } catch (error) {
        console.error('[theme-preload] failed to apply theme:', error);
      }
    });
  };

  ipcRenderer.invoke('theme:get').then((theme) => {
    if (!updateReceived) applyTheme(theme);
  }).catch((error) => {
    console.error('[theme-preload] failed to load theme:', error);
  });
  ipcRenderer.on('theme:update', (_event, theme) => {
    updateReceived = true;
    applyTheme(theme);
  });
})();
