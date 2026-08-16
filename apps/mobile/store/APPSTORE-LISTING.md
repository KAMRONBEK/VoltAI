# App Store Connect — VoltAI UZ listing pack (v1.0.0)

Everything to fill in App Store Connect for the iOS release. Copy the fields verbatim.
The iOS build is already on EAS: **v1.0.0 (build 9), SDK 57**, signed for the App Store
(IPA in `~/Downloads/VoltAI-release/VoltAI-UZ-1.0.0-build9-ios.ipa`). Bundle id `uz.voltai.app`,
Apple Team `7BLQ2AA4R3`.

---

## 1. App information (once per app)

| Field | Value |
|---|---|
| **Name** | `VoltAI UZ` |
| **Bundle ID** | `uz.voltai.app` |
| **Primary language** | English (U.K.) — this is the language the Uzbekistan storefront shows |
| **Primary category** | Navigation |
| **Secondary category** | Travel |
| **Content rights** | Does not contain, show, or access third-party content (station data is aggregated public data — see review note) |
| **Age rating** | Answer **None** to every question → result **4+** |
| **Copyright** | `2026 Kamronbek Juraev` |

**URLs**
- Support URL: `https://voltai.uz`
- Marketing URL: `https://voltai.uz`
- Privacy Policy URL: `https://voltai.uz/en/privacy`  *(deploy `apps/web` first so this page is live and matches `store/privacy-policy.html`)*

---

## 2. Localizations

Add **two** localizations so both language groups get search coverage (the UZ storefront itself
renders the English (U.K.) one; Russian covers RU-language devices region-wide).

### English (U.K.) — primary
- **Subtitle** (≤30): `EV charger map for Uzbekistan`  *(29)*
- **Promotional text** (≤170): `Find a free EV charger near you, live — across every operator in Uzbekistan.`
- **Keywords** (≤100, comma-separated, no name/subtitle words):
  `зарядка,электромобиль,ЭЗС,charging,charger,station,CCS,GBT,EV map,route,Tashkent,Узбекистан`
- **Description**: see §3.

### Russian (Русский)
- **Subtitle** (≤30): `Электрозаправки Узбекистана`  *(27)*
- **Promotional text**: `Найдите свободную зарядку для электромобиля рядом — по всем операторам Узбекистана.`
- **Keywords** (≤100): `зарядка,ЭЗС,электрозаправка,электромобиль,станция,разъём,CCS,GBT,маршрут,Ташкент,карта`
- **Description**: Russian version of §3 (translate 1:1 — same claims, keep the "unofficial / not
  affiliated / may be delayed" paragraph).

> App Store Connect does not offer Uzbek as a storefront language, so there is no Uzbek localization
> to add here. Uzbek-Latin search words (`zaryadka`, `stansiya`) are covered by the Latin tokens in
> the English keyword field.

---

## 3. Description (English — paste into the Description field)

VoltAI is the fastest way to find an electric-vehicle charger in Uzbekistan. It brings the major charging operators together on a single live map, so you can see at a glance where the nearest stations are, what they support, and whether a plug is free right now — without hopping between half a dozen separate operator apps.

Each station shows an availability dot refreshed every few minutes, so you know before you drive whether a connector is open, in use, or offline. Tap any station for its address, connector types, and power output, and get directions in one tap in your favourite navigation app. Powerful filters let you narrow the map to exactly what your car needs: by connector type, minimum charging power, operator, city, or only stations that are available right now.

Going further than one charge? The trip planner works out where to stop. Add your car to the garage once — its real-world range, its connector (GB/T, CCS2, and more) and how fast it charges — and VoltAI plans a route with charging stops that physically fit your car, tells you how long each stop takes, and offers a fastest, a fewest-stops and a most-buffer option. It never plans a leg that ends below the reserve you choose, so you arrive with battery to spare, not on empty. Plans are saved on your phone, so a trip you planned at home is still there when you have no signal on the road.

VoltAI is account-free and private by design. There is no sign-up, no login, and no password. Your location is used on your device, while the app is open, to centre the map and show which chargers are near you. When you plan a trip, the start and end points you choose and your car's figures are sent to VoltAI's server to compute the route (and forwarded to a routing provider for the road geometry) — with no name, account or device identifier attached, and nothing kept about you. There are no ads, no analytics, and no tracking. Your preferences, cars and saved trips stay on your phone.

VoltAI is an independent app and is not affiliated with any charging operator. Station locations and availability are gathered from the operators' own public apps and may occasionally be delayed or incomplete — always check the charger itself before relying on it.

---

## 4. Version 1.0.0 (this submission)

- **Build**: select **1.0.0 (9)** in App Store Connect after it finishes processing.
- **What's New** (paste):

VoltAI UZ 1.0 — first release.
• One live map of EV chargers across Uzbekistan (Tokbor, Spectre Energy, K-Watt, Beon): connector types, power and per-plug availability, refreshed every few minutes.
• Filters by connector, power, operator, city and "available now".
• Trip planner: add your car once (real range, GB/T or CCS, charging speed) and get a route with charging stops that fit it — and arrive with battery to spare.
• Saved trips work offline. No account, no ads, no tracking.

---

## 5. Assets

| Asset | File | Notes |
|---|---|---|
| **App icon** | pulled from the build's asset catalog automatically | 1024×1024 also at `store/assets/appstore-icon-1024.png` (opaque, no alpha) if a manual upload is ever needed |
| **iPhone 6.7″ screenshots** (required) | `store/assets/ios-6.7/ios-01…06.png` | 1290×2796. This size also satisfies the 6.9″ requirement — upload the same six there. |
| iPad | not required | `ios.supportsTablet = false`, so no iPad screenshots. |
| App preview video | *(skip for iOS)* | the `store/assets/…/VoltAI-UZ-demo.mp4` clip is captured on Android — do not upload it as an iOS preview. |

Screenshot order (hero first): **01 route/plan → 02 map → 03 settings (reserve) → 04 garage → 05 plan → 06 station**.

---

## 6. App Privacy (App Store "nutrition labels")

Answer **Yes** to "Do you collect data?", then:

- **Location — Precise Location** and **Location — Coarse Location**
  - Used for: **App Functionality** (only)
  - Linked to the user's identity: **No**
  - Used for tracking: **No**
  - (Context, not a separate answer: on the map, location is used on-device; when planning a trip
    the chosen coordinates are sent to VoltAI's server and a routing provider to compute the route —
    still App Functionality, no identifier attached.)
- **Everything else: Not Collected.** No analytics, no diagnostics, no advertising, no identifiers,
  no contact info, no user content.
- **Data used to track you: None.**

Export compliance: nothing to upload — `ITSAppUsesNonExemptEncryption = false` is already in the
build (standard HTTPS/TLS only), so the export question is skipped.

---

## 7. App Review information

- **Sign-in required**: No (account-free) — leave the demo-account fields blank.
- **Contact**: your name, phone, and `support@voltai.uz`.
- **Notes to reviewer** (paste):

VoltAI is a free, account-free EV-charging map and trip planner for Uzbekistan. No login is needed — open the app and the map loads. It requires an internet connection to fetch live charging-station data from our server (https://api.voltai.uz). Location permission is optional and only centres the map; you can decline it and still browse and plan. Station data is aggregated from Uzbek charging operators' own public apps; the app is independent and not affiliated with any operator, and this is stated in-app and in the listing. Suggested test: open the app, allow location (or skip), browse the map, open the Route tab and tap the sample "Tashkent → Qarshi" trip to see the planned charging stops.

---

## 8. Submitting the build (when you're ready)

The build is already uploaded to EAS. To push it to App Store Connect:

```bash
cd apps/mobile
npx eas submit --platform ios --latest
```
It will ask for your Apple ID (or an App Store Connect API key). First time only, create the app
record in App Store Connect (My Apps → + → New App → iOS → name **VoltAI UZ**, primary language
English (U.K.), bundle ID `uz.voltai.app`, SKU `voltai-uz`). After the build finishes processing
(~15–30 min), select it under this version, fill §1–§7 above, and Submit for Review.
