import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * Returns a narrowed `'light' | 'dark'`. React Native 0.86 widened `ColorSchemeName`
 * to include `'unspecified'` (and null), which can't index our `Colors` map — so we
 * treat anything that isn't `'dark'` as `'light'` (the Expo default).
 */
export function useColorScheme(): 'light' | 'dark' {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light';
}
