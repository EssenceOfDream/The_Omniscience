const APP_USER_MODEL_ID_PATTERN = /^[^\\/:!]+_[^\\/:!]+![^\\/:!]+$/;

export function isWindowsUwpAppUserModelId(value) {
  return typeof value === 'string' && APP_USER_MODEL_ID_PATTERN.test(value);
}

export function parseWindowsUwpApps(output) {
  const parsed = JSON.parse(output);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const seen = new Set();
  const apps = [];

  for (const entry of entries) {
    const appUserModelId = entry?.AppID;
    if (!isWindowsUwpAppUserModelId(appUserModelId)) continue;

    const key = appUserModelId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    apps.push({
      title: typeof entry.Name === 'string' && entry.Name.trim()
        ? entry.Name.trim()
        : appUserModelId,
      appUserModelId,
    });
  }

  return apps;
}
