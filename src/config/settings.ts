// Per-device user settings persisted in localStorage. Storage can be
// unavailable (private mode, blocked site data), so every access is guarded
// and the app works with defaults.

import { DEFAULT_SETTINGS, type UserSettings } from './config';

const STORAGE_KEY = 'tennis-coach.settings.v1';

export function loadSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): UserSettings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitize({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: UserSettings, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore: settings simply won't persist.
  }
}

function sanitize(s: UserSettings): UserSettings {
  return {
    // Only kept when the user explicitly chose a supported language.
    ...(s.language === 'zh-CN' || s.language === 'en-US' ? { language: s.language } : {}),
    handedness: s.handedness === 'left' ? 'left' : 'right',
    netDirection: s.netDirection === 'left' || s.netDirection === 'right' ? s.netDirection : 'auto',
    voiceEnabled: s.voiceEnabled !== false,
    targetPoseFps: Number.isFinite(s.targetPoseFps)
      ? Math.min(60, Math.max(10, Math.round(s.targetPoseFps)))
      : DEFAULT_SETTINGS.targetPoseFps,
    cameraFacing: s.cameraFacing === 'user' ? 'user' : 'environment',
  };
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
