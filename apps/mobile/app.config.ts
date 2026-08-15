import type { ExpoConfig, ConfigContext } from '@expo/config';
import appJson from './app.json';

type AppJson = { expo: ExpoConfig };

const { expo: baseExpo } = appJson as unknown as AppJson;

/**
 * Navigation apps the station sheet may hand a coordinate to (via react-native-map-link).
 * Android 11+ only lets `canOpenURL` see schemes declared in the manifest's `<queries>`, and iOS
 * needs the same list under `LSApplicationQueriesSchemes` — without these, detection reliably
 * finds nothing on a phone that has Yandex Navigator and 2GIS installed.
 */
const NAV_APP_SCHEMES = ['yandexnavi', 'yandexmaps', 'dgis', 'waze', 'comgooglemaps', 'mapsme'];

export default ({ config }: ConfigContext): ExpoConfig => {
  // `app.json` can't evaluate env vars, but `app.config.ts` can. This keeps the Yandex
  // MapKit API key out of version control while still enabling the map on native builds.
  //
  // Two names are accepted. `YANDEX_MAPKIT_API_KEY` is the build-time one: it goes into the
  // native config through the plugin and never touches the JS bundle. `EXPO_PUBLIC_…` is what
  // app/_layout.tsx reads at runtime (a dev convenience — swap the key with a Metro reload). If
  // only the public one is set, it is passed to the plugin as well, so the native path also works
  // instead of silently building a map with an empty key.
  const yandexMapKitApiKey =
    process.env.YANDEX_MAPKIT_API_KEY?.trim() || process.env.EXPO_PUBLIC_YANDEX_MAPKIT_API_KEY?.trim() || '';

  // Fail fast on EAS: a preview/production build with no MapKit key is a build that installs
  // fine and shows a blank map. `development` is exempt — it may rely on the runtime key.
  const easProfile = process.env.EAS_BUILD_PROFILE;
  if (easProfile && easProfile !== 'development' && !yandexMapKitApiKey) {
    throw new Error(
      `[app.config.ts] EAS build profile "${easProfile}" has no Yandex MapKit key. Set YANDEX_MAPKIT_API_KEY ` +
        '(preferred) or EXPO_PUBLIC_YANDEX_MAPKIT_API_KEY in the EAS environment for this profile.'
    );
  }

  // Cleartext (plain http) is only needed when the API base URL itself is http — i.e. the
  // `development` profile talking to the phone's own Termux backend at http://127.0.0.1:8080.
  // preview/production target https://api.voltai.uz, so their builds keep Android's default of
  // refusing cleartext, which is what the store expects.
  // Same normalisation as lib/apiBaseUrl.ts (trim, empty → production, no trailing slash).
  const apiBase = (process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || 'https://api.voltai.uz').replace(/\/+$/, '');
  const usesCleartextTraffic = apiBase.startsWith('http://');

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
        LSApplicationQueriesSchemes: Array.from(
          new Set([
            ...((baseExpo.ios?.infoPlist?.LSApplicationQueriesSchemes as string[] | undefined) ?? []),
            ...NAV_APP_SCHEMES,
          ])
        ),
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
      // Nothing in the app draws over other apps; a transitive dependency merging this in would
      // trip Play's "display over other apps" review for no reason.
      blockedPermissions: Array.from(
        new Set([...(baseExpo.android?.blockedPermissions ?? []), 'android.permission.SYSTEM_ALERT_WINDOW'])
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
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic,
            // Package visibility for the navigation apps the station sheet offers (see
            // NAV_APP_SCHEMES). `geo:` needs no declaration — starting an intent is not querying.
            manifestQueries: {
              intent: NAV_APP_SCHEMES.map((scheme) => ({ action: 'VIEW', data: { scheme } })),
            },
          },
        },
      ],
    ],
  };
};
