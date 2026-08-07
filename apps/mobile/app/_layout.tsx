import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavThemeProvider,
} from 'expo-router/react-navigation';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { initialize as initYandexMapKit } from 'expo-yandex-mapkit';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemeProvider } from '@/lib/theme/theme-context';

// Keep the native splash up until the app's first frame is mounted (hidden in ThemedRoot below).
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  // Initialize Yandex MapKit at runtime when a key is provided via EXPO_PUBLIC_ env.
  // This is a dev convenience: it lets the key be swapped in with a Metro reload instead
  // of a native rebuild. In production the key is baked at build time by the config plugin
  // (app.config.ts), in which case this call is a harmless no-op.
  useEffect(() => {
    const key = process.env.EXPO_PUBLIC_YANDEX_MAPKIT_API_KEY;
    if (key) {
      initYandexMapKit(key).catch(() => undefined);
    }
  }, []);

  return (
    <ThemeProvider>
      <ThemedRoot />
    </ThemeProvider>
  );
}

// Consumes the resolved scheme from ThemeProvider so the navigation theme + status bar follow
// the user's light/dark/system choice. Must live below <ThemeProvider>.
function ThemedRoot() {
  const colorScheme = useColorScheme();

  // No in-app animated splash — hide the native splash as soon as the first frame is mounted,
  // so the app goes straight from the native splash into the UI.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <NavThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      </GestureHandlerRootView>
    </NavThemeProvider>
  );
}
