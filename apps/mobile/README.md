# VoltAI Mobile

The VoltAI EV-charging app for Uzbekistan — map of charging stations, live connector statuses,
trip planner, garage and saved trips. Expo SDK 57 / React Native 0.86 / React 19.2, with
file-based routing via `expo-router` (screens live in `app/`).

## Expo Go is NOT supported

The map is [`expo-yandex-mapkit`](https://www.npmjs.com/package/expo-yandex-mapkit), which ships
native code. Expo Go cannot load it — you need a **development build**:

```bash
npm install
npx expo prebuild --clean
npx expo run:android      # or: npx expo run:ios
```

After the first native build, day-to-day work is just `npx expo start` against that dev build.
Anything that changes native config (app icon, splash, plugins, the MapKit key baked in at build
time) requires another `prebuild` + `run:` cycle.

> ⚠️ Do **not** run `npm run reset-project`. That script is left over from `create-expo-app`; it
> moves `app/` aside into `app-example/` and creates a blank one — i.e. it would move the real
> VoltAI app out of the way.

## Environment

Copy [`.env.example`](.env.example) to `.env`:

```bash
cp .env.example .env
```

- `YANDEX_MAPKIT_API_KEY` — **required**. The Yandex MapKit Mobile SDK key, read by
  `app.config.ts` and baked into the native build. Get one at
  [developer.tech.yandex.ru](https://developer.tech.yandex.ru); activation takes ~15 min.
  Without it the map will not render.
- `EXPO_PUBLIC_YANDEX_MAPKIT_API_KEY` — dev convenience: the same value inlined into the JS
  bundle so it can be swapped with a Metro reload instead of a native rebuild.
- `EXPO_PUBLIC_API_BASE_URL` — optional override of the API base URL (default
  `https://api.voltai.uz`). Useful for pointing at a locally-run API, e.g.
  `http://127.0.0.1:8080` through `adb reverse tcp:8080 tcp:8080`.

There is deliberately **no MyTaxi key here** — route planning happens server-side, so that key
lives in `apps/api/.env`. An `EXPO_PUBLIC_` key is extractable from any shipped bundle.

## Where the data comes from

The app reads from the VoltAI API at **`https://api.voltai.uz`** (`/api/stations`,
`/api/stations/statuses`, `/api/plan`). That API is not a cloud service: it is served from a
single always-on Android phone running Express + embedded SQLite + the operator scrapers, exposed
through an outbound Cloudflare Tunnel. See
[**Production architecture** in the root README](../../README.md#production-architecture), with
the detail in [`/ARCHITECTURE.md`](../../ARCHITECTURE.md) and
[`apps/api/RUNBOOK.md`](../api/RUNBOOK.md).

The app is account-free: there is no sign-in, and the garage and saved trips are stored on-device
in AsyncStorage.

## Scripts

```bash
npm run start      # Metro (against an installed dev build)
npm run android    # native build + run on a connected device/emulator
npm run ios
npm run lint
```

## Learn more

- [Expo documentation](https://docs.expo.dev/) and [development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [`expo-router` file-based routing](https://docs.expo.dev/router/introduction)
