import DEFAULT_THEME_SETTINGS from './DEFAULT_THEME_SETTINGS.mjs';

export default function (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Omni Theme settings');
  }
  const settings = { ...DEFAULT_THEME_SETTINGS, ...value };
  if (typeof settings.enabled !== 'boolean'
    || !Number.isFinite(settings.maxR) || settings.maxR < 0 || settings.maxR > 255
    || !Number.isFinite(settings.maxG) || settings.maxG < 0 || settings.maxG > 255
    || !Number.isFinite(settings.maxB) || settings.maxB < 0 || settings.maxB > 255
    || !Number.isFinite(settings.targetAlpha) || settings.targetAlpha < 0 || settings.targetAlpha > 1
    || !Number.isFinite(settings.textBrightness) || settings.textBrightness < 0 || settings.textBrightness > 255
    || !Number.isFinite(settings.blurShadow) || settings.blurShadow < 0 || settings.blurShadow > 30
    || typeof settings.shadowColor !== 'string'
    || !/^#[\da-f]{6}$/i.test(settings.shadowColor)) {
    throw new Error('Invalid Omni Theme settings');
  }
  return {
    enabled: settings.enabled,
    maxR: settings.maxR,
    maxG: settings.maxG,
    maxB: settings.maxB,
    targetAlpha: settings.targetAlpha,
    textBrightness: settings.textBrightness,
    blurShadow: settings.blurShadow,
    shadowColor: settings.shadowColor,
  };
}