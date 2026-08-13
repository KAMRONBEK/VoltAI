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
import { useHydratePlanHistory } from '@/lib/plan/plan-history-atoms';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { useHydrateGarage } from '@/lib/vehicles/garage-atoms';

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

  // Read the saved garage and trip history once, at app start. jotai's default store is
  // module-level, so no Provider is needed — these just have to run above anything that reads
  // those atoms. Only the trip *index* is read here; the plans themselves stay on disk.
  useHydrateGarage();
  useHydratePlanHistory();

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
        {/* Trip input is the Route tab; everything it pushes to — the garage, the map picker,
            the results and the saved trips — is a root Stack route, so those screens get a real
            back stack and never inherit the floating pill tab bar's inset. */}
        <Stack>
          {/* Only the tab shell is declared here. `name="garage"` and `name="plan"` used to be too,
              but they match no route — without a `garage/_layout` / `plan/_layout` the real names
              are `garage/index`, `garage/[id]`, `plan/pick`, `plan/results`, `plan/history` — so
              expo-router warned at every launch while the entries did nothing. Every pushed screen
              already sets its own title through its own `<Stack.Screen options>`, which is the one
              place that stays in step with what the screen actually is. */}
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      </GestureHandlerRootView>
    </NavThemeProvider>
  );
}
