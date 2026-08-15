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
  bundle so it can be swapped with a Metro reload instead of a native rebuild. If it is the only
  one set, `app.config.ts` also passes it to the native plugin. On EAS, any profile other than
  `development` fails the build up front when neither key is present.
- `EXPO_PUBLIC_API_BASE_URL` — optional override of the API base URL (default
  `https://api.voltai.uz`; empty counts as unset). Useful for pointing at a locally-run API, e.g.
  `http://127.0.0.1:8080` through `adb reverse tcp:8080 tcp:8080`. An `http://` value is also what
  turns on Android cleartext traffic in `app.config.ts` — https builds keep it off.

There is deliberately **no MyTaxi key here** — route planning happens server-side, so that key
lives in `apps/api/.env`. An `EXPO_PUBLIC_` key is extractable from any shipped bundle.

## Where the data comes from

The app reads from the VoltAI API at **`https://api.voltai.uz`** (`/api/stations`,
`/api/stations/statuses`, `/api/plan`, `/api/client-config`). That API is not a cloud service: it
is served from a single always-on Android phone running Express + embedded SQLite + the operator
scrapers, to be exposed through an outbound Cloudflare Tunnel. See
[**Production architecture** in the root README](../../README.md#production-architecture), with
the detail in [`/ARCHITECTURE.md`](../../ARCHITECTURE.md) and
[`apps/api/RUNBOOK.md`](../api/RUNBOOK.md).

> **Status (2026-08-16):** the backend is deployed and supervised on the phone, but
> `https://api.voltai.uz` is **not cut over yet** (the DNS zone is still on ahost.uz and the
> record points at a retired Vercel function answering HTTP 500 — Gate 2 in
> [`apps/api/docs/GATES.md`](../api/docs/GATES.md)). Until then a `preview`/`production` build
> shows the truthful "can't reach the server" state and the last-known-good cache; the
> `development` EAS profile targets `http://127.0.0.1:8080`, i.e. the API running on the same
> phone (or a dev-box API via `adb reverse tcp:8080 tcp:8080`).

How the app treats that data (2026-08-16):

- The station catalog is fetched in 1000-row pages (`/api/stations?limit=1000`, de-duplicated by
  id) **independently of GPS** — a denied location permission never blocks the map. Failed loads
  retry and refetch automatically when the device comes back online (NetInfo) or the app returns
  to the foreground; otherwise the last-known-good AsyncStorage cache is shown with an honest
  error/offline state — never fabricated stations.
- The **Live** pill is driven by the data age the backend reports on `/api/stations/statuses`
  (`lastMergeAt` / `stale`), not by whether the last request succeeded.
- At launch the app reads `GET /api/client-config` (fail-open): it can show a maintenance banner,
  a one-time message, or a blocking "update required" modal when the installed version is below
  `minAppVersion`.
- Navigation is a hand-off to an installed maps app (Yandex Navigator / Yandex Maps / 2GIS / Waze
  / Google Maps, declared in the manifest `<queries>` / `LSApplicationQueriesSchemes`), with a
  `geo:` / Apple Maps fallback.

The app is account-free: there is no sign-in, and the garage and saved trips are stored on-device
in AsyncStorage. There are no analytics, ads or tracking SDKs. The privacy policy is shown in-app
(Settings → About) and published at <https://voltai.uz/uz/privacy>; the same text is in
[`store/privacy-policy.html`](store/privacy-policy.html). Note that planning a trip sends the
chosen start/end coordinates and the car's figures to the VoltAI server (which forwards only the
coordinates to the MyTaxi routing provider) — that is the one time data leaves the phone.

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
