import type { ExpoConfig, ConfigContext } from '@expo/config';
import appJson from './app.json';

type AppJson = { expo: ExpoConfig };

const { expo: baseExpo } = appJson as unknown as AppJson;

export default ({ config }: ConfigContext): ExpoConfig => {
  // `app.json` can't evaluate env vars, but `app.config.ts` can.
  // This keeps secrets out of version control while still enabling Google Maps on iOS/Android builds.
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY ?? '';

  return {
    // `config` contains Expo defaults; `baseExpo` contains our checked-in config.
    ...config,
    ...baseExpo,
    ios: {
      ...config.ios,
      ...baseExpo.ios,
      config: {
        ...(config.ios?.config ?? {}),
        ...(baseExpo.ios?.config ?? {}),
        googleMapsApiKey,
      },
      infoPlist: {
        ...(config.ios?.infoPlist ?? {}),
        ...(baseExpo.ios?.infoPlist ?? {}),
        NSLocationWhenInUseUsageDescription:
          'VoltAI uses your location to show nearby EV chargers and estimate distance.',
      },
    },
    android: {
      ...config.android,
      ...baseExpo.android,
      config: {
        ...(config.android?.config ?? {}),
        ...(baseExpo.android?.config ?? {}),
        googleMaps: {
          ...(config.android?.config?.googleMaps ?? {}),
          ...(baseExpo.android?.config?.googleMaps ?? {}),
          apiKey: googleMapsApiKey,
        },
      },
      permissions: Array.from(
        new Set([
          ...(config.android?.permissions ?? []),
          ...(baseExpo.android?.permissions ?? []),
          'ACCESS_COARSE_LOCATION',
          'ACCESS_FINE_LOCATION',
        ])
      ),
    },
  };
};

