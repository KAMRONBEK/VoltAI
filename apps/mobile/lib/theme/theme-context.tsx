import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { Colors, type ThemeColors } from '@/constants/theme';
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
  type ThemePreference,
} from '@/lib/settings/appSettings';

/**
 * App-wide theme state. Holds the user's persisted preference (system/light/dark), resolves it
 * against the OS scheme, and exposes the active token set. `hooks/use-color-scheme` reads the
 * resolved `scheme` from here, so every existing `Colors[colorScheme]` call site follows the
 * user's choice for free.
 */

type Scheme = 'light' | 'dark';

type ThemeContextValue = {
  preference: ThemePreference;
  scheme: Scheme;
  colors: ThemeColors;
  setPreference: (pref: ThemePreference) => void;
  isLoaded: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const os: Scheme = useRNColorScheme() === 'dark' ? 'dark' : 'light';
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_APP_SETTINGS.themePreference);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The splash waits on `isLoaded`, so a storage failure must still resolve it — with the
    // default preference — rather than reject and leave the flag false.
    loadAppSettings()
      .then((s) => {
        if (cancelled) return;
        setPreferenceState(s.themePreference);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    // Best-effort persist; a failed write just means the choice isn't remembered next launch.
    void saveAppSettings({ themePreference: pref });
  }, []);

  const scheme: Scheme = preference === 'system' ? os : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, scheme, colors: Colors[scheme], setPreference, isLoaded }),
    [preference, scheme, setPreference, isLoaded]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Non-throwing accessor — returns null when rendered outside a ThemeProvider. */
export function useThemeContextOptional(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

/** Full theme state (preference + setter). Throws if no ThemeProvider is mounted. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

/** The active scheme's semantic token set. Falls back to the OS scheme outside a provider. */
export function useThemeColors(): ThemeColors {
  const ctx = useContext(ThemeContext);
  const os: Scheme = useRNColorScheme() === 'dark' ? 'dark' : 'light';
  return ctx ? ctx.colors : Colors[os];
}
