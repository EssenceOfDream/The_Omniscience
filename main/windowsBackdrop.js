export function installWindowsBackdropBlur(
  window,
  {
    platform = process.platform,
    apply,
    logError = console.error,
  } = {},
) {
  if (platform !== 'win32' || !window || window.isDestroyed()) return;
  if (typeof apply !== 'function') {
    throw new TypeError('A Windows backdrop blur operation is required');
  }

  let applied = false;
  let pending = null;

  const applyBlur = () => {
    if (window.isDestroyed() || applied || pending) return;

    pending = Promise.resolve()
      .then(() => apply(window))
      .then((result) => {
        if (result === false) throw new Error('Windows did not enable backdrop blur');
        applied = true;
      })
      .catch((error) => {
        logError('[windows-backdrop] failed to enable window blur:', error.message);
      })
      .finally(() => {
        pending = null;
      });
  };

  window.once('ready-to-show', applyBlur);
  window.on('show', applyBlur);
}
