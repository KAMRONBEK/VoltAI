# VoltAI — Store Listing Metadata (draft)

Draft copy for the Apple App Store and Google Play listings. Character limits are noted per field.
Fill in every `PLACEHOLDER` before submission.

---

## App name
**VoltAI**

- Play Store title (<= 30 chars): `VoltAI` (6) — or `VoltAI: EV Charging Map` (23) if a descriptor is wanted.
- App Store name (<= 30 chars): `VoltAI` (6)

## App Store subtitle (<= 30 chars)
`EV charger map for Uzbekistan` (29)

Alternate: `Live EV charging station map` (28)

## Play short description (<= 80 chars)
`Live EV charger map for Uzbekistan — availability across every operator.` (72)

## Promotional text / one-liner
`Find a free EV charger near you, live — across every operator in Uzbekistan.`

(App Store "Promotional Text" is <= 170 chars and can be updated without a new build — good place for the current tagline.)

---

## Full description

VoltAI is the fastest way to find an electric-vehicle charger in Uzbekistan. It brings the major charging operators together on a single live map, so you can see at a glance where the nearest stations are, what they support, and whether a plug is free right now — without hopping between half a dozen separate operator apps.

Each station shows an availability dot refreshed every few minutes, so you know before you drive whether a connector is open, in use, or offline. Tap any station for its address, connector types, and power output, and get directions in one tap in your favourite navigation app. Powerful filters let you narrow the map to exactly what your car needs: filter by connector type, by minimum charging power, by operator, by city, or show only stations that are available right now.

Going further than one charge? The trip planner works out where to stop. Add your car to the garage once — its real-world range, its connector (GB/T, CCS2, and more) and how fast it charges — and VoltAI plans a route with charging stops that physically fit your car, tells you how long each stop takes, and offers a fastest, a fewest-stops and a most-buffer option. Plans are saved on your phone, so a trip you planned at home is still there when you have no signal on the road.

VoltAI is account-free and private by design. There is no sign-up, no login, and no password — open the app and the map is there. Your location is used on your device, while the app is open, to centre the map and show which chargers are near you. When you plan a trip, the start and end points you chose and your car's figures are sent to VoltAI's server to compute the route (and forwarded to a routing provider for the road geometry) — with no name, account or device identifier attached, and nothing kept about you. There are no ads, no analytics, and no tracking. Your preferences, cars and saved trips stay on your phone.

VoltAI is an independent app and is not affiliated with any charging operator. Station locations and availability are gathered from the operators' own public apps and may occasionally be delayed or incomplete — always check the charger itself before relying on it.

Built for real driving in Uzbekistan, VoltAI keeps the map fast and readable and focuses on one job: getting you to a working charger — and, when the trip is a long one, to the next one after that.

---

## Keywords (App Store: comma-separated, <= 100 chars total; trim to fit)

`EV, charging, charger, electric car, EV map, charging station, connector, CCS, Type 2, GBT, charge, Uzbekistan, Tashkent, availability, EV charge`

Suggested 12–15 keyword set:
1. EV
2. EV charging
3. charging station
4. EV charger
5. electric car
6. charge map
7. connector type
8. CCS / Type 2 / GB/T
9. charging availability
10. Uzbekistan
11. Tashkent
12. EV trip
13. charging network
14. fast charging
15. plug

(Note: on the App Store, do not repeat words already in the app name/subtitle in the keyword field — reclaim that space for synonyms.)

## Categories

- **App Store** — Primary: **Navigation**. Secondary: **Travel** (alternatively primary Travel / secondary Navigation).
- **Google Play** — Category: **Maps & Navigation**. (Alternative: Travel & Local.)

## URLs and contact

- Support URL: https://voltai.uz (the marketing site; its footer carries the support address)
- Marketing URL (optional): https://voltai.uz
- Privacy Policy URL: https://voltai.uz/uz/privacy — this is the URL the app's Settings screen links to. `store/privacy-policy.html` is the same policy as a standalone page; keep the two in step (the web copy lives in `apps/web/src/app/[lang]/privacy/page.tsx`).
- Support email: support@voltai.uz (the address already used across `apps/web`)

## Data-safety answers (derived from what the app does as of 2026-08-16)

- **Location** — used for App Functionality. On-device for the map ("my location" layer, distance). When the user plans a trip, the chosen start/end coordinates are transmitted to VoltAI's server and forwarded to a routing provider (MyTaxi). Not linked to identity, not used for tracking, no account. Say "collected/shared" for the planner case; do not say "on-device only".
- **App info / vehicle figures** — the car's range, connector, charging speed and consumption are sent with a plan request. Not linked to identity.
- Everything else: not collected. No analytics, no advertising, no crash-reporting SDK, no advertising ID.

## Localization note

Primary market is Uzbekistan. Consider providing Russian (`ru`) and Uzbek (`uz`) localized name, subtitle, description, and keywords in addition to English for better store search and conversion. UI language and map locale are currently `ru_RU`.
