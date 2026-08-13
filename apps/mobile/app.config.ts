import type { ExpoConfig, ConfigContext } from '@expo/config';
import appJson from './app.json';

type AppJson = { expo: ExpoConfig };

const { expo: baseExpo } = appJson as unknown as AppJson;

export default ({ config }: ConfigContext): ExpoConfig => {
  // `app.json` can't evaluate env vars, but `app.config.ts` can. This keeps the Yandex
  // MapKit API key out of version control while still enabling the map on native builds.
  // With the key supplied here, MapKit initializes automatically at app startup.
  const yandexMapKitApiKey = process.env.YANDEX_MAPKIT_API_KEY ?? '';

  return {
    // `config` contains Expo defaults; `baseExpo` contains our checked-in config.
    ...config,
    ...baseExpo,
    ios: {
      ...config.ios,
      ...baseExpo.ios,
      infoPlist: {
        ...(config.ios?.infoPlist ?? {}),
        ...(baseExpo.ios?.infoPlist ?? {}),
        NSLocationWhenInUseUsageDescription:
          'VoltAI uses your location to show nearby EV chargers and estimate distance.',
        // No custom/non-standard crypto — declaring this skips the export-compliance prompt on
        // every App Store submission (the app only uses standard HTTPS/TLS).
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      ...config.android,
      ...baseExpo.android,
      permissions: Array.from(
        new Set([
          ...(config.android?.permissions ?? []),
          ...(baseExpo.android?.permissions ?? []),
          'ACCESS_COARSE_LOCATION',
          'ACCESS_FINE_LOCATION',
        ])
      ),
    },
    plugins: [
      // Keep the checked-in plugins (expo-router, splash, font, image, etc.) …
      ...(baseExpo.plugins ?? []),
      // … and add Yandex MapKit here so the API key is injected from the environment,
      // never committed. `lite` covers map + markers + clustering (navigation is handled
      // by react-native-map-link); `full` would add search/routing/offline we don't use.
      [
        'expo-yandex-mapkit',
        {
          apiKey: yandexMapKitApiKey,
          locale: 'ru_RU',
          flavor: 'lite',
          locationWhenInUsePermission:
            'VoltAI uses your location to show nearby EV chargers and estimate distance.',
        },
      ],
      // Allow cleartext HTTP so release builds can reach the on-device backend at
      // http://127.0.0.1:8080. Debug builds already permit cleartext; release does not by
      // default. The production/store profile targets https://api.voltai.uz, so this only
      // affects the on-device (dev/preview) builds that talk to the phone's Termux API.
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic: true,
          },
        },
      ],
    ],
  };
};
