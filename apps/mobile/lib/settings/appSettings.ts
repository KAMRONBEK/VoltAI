import { getJson, setJson } from '@/lib/storage/jsonStorage';
import { StorageKeys } from '@/lib/storage/storageKeys';

/**
 * Device-local app settings. The app is account-free: everything the user configures lives
 * on this device via AsyncStorage, nothing is synced to a server. Add new preferences here
 * and they'll merge over the defaults on load.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

export type AppSettings = {
  /** 'system' follows the OS; 'light'/'dark' force a scheme. */
  themePreference: ThemePreference;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  themePreference: 'system',
};

export async function loadAppSettings(): Promise<AppSettings> {
  const stored = await getJson<Partial<AppSettings>>(StorageKeys.appSettings);
  return { ...DEFAULT_APP_SETTINGS, ...(stored ?? {}) };
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  await setJson(StorageKeys.appSettings, settings);
}
