import { useEffect, useState } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { useThemeContextOptional } from '@/lib/theme/theme-context';

/**
 * Web variant. To support static rendering, the scheme is only trusted after the client has
 * hydrated (the first render returns `'light'` to match the server). Once hydrated it reflects
 * the ThemeProvider's resolved preference, or the OS scheme when no provider is mounted.
 */
export function useColorScheme(): 'light' | 'dark' {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const ctx = useThemeContextOptional();
  const os = useRNColorScheme() === 'dark' ? 'dark' : 'light';

  if (!hasHydrated) return 'light';
  return ctx ? ctx.scheme : os;
}
