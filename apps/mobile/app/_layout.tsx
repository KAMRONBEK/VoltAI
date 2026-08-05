import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { initialize as initYandexMapKit } from 'expo-yandex-mapkit';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplash } from '@/components/animated-splash';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Keep the native splash up until our in-app animation is mounted.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

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
    <AnimatedSplash>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="auto" />
        </GestureHandlerRootView>
      </ThemeProvider>
    </AnimatedSplash>
  );
}
