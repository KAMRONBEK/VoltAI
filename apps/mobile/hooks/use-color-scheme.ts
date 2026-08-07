import { useColorScheme as useRNColorScheme } from 'react-native';

import { useThemeContextOptional } from '@/lib/theme/theme-context';

/**
 * Returns the app's active `'light' | 'dark'` scheme. When a ThemeProvider is mounted this
 * reflects the user's persisted preference (system/light/dark); otherwise it falls back to the
 * OS scheme. React Native 0.86 widened `ColorSchemeName` to include `'unspecified'`/null, so
 * anything that isn't `'dark'` is treated as `'light'` (the Expo default).
 */
export function useColorScheme(): 'light' | 'dark' {
  const ctx = useThemeContextOptional();
  const os = useRNColorScheme() === 'dark' ? 'dark' : 'light';
  return ctx ? ctx.scheme : os;
}
