# VoltAI — Production / Store Release Checklist

Honest status of what's ready to ship and what still blocks a public release.
Verified against `app.json`, `app.config.ts`, `eas.json`, and app source on 2026-08-09.

Legend: **(A)** done · **(B)** needs the owner / external action · **(C)** risks that can block or reverse a release.

---

## (A) DONE — verified in the project

- **App icon** — `assets/images/icon.png` present and wired via `app.json` `expo.icon`. (Requirement: 1024×1024, no alpha channel — keep it opaque; Apple rejects icons with transparency.)
- **Adaptive Android icon** — foreground / background / monochrome layers configured under `android.adaptiveIcon`.
- **EAS build profiles** — `eas.json` defines `development`, `preview`, and `production` profiles. Dev/preview build internal APKs; production builds an Android **app-bundle (.aab)** with `autoIncrement`.
- **Bundle identifiers set on both platforms** — iOS `ios.bundleIdentifier = uz.voltai.app`, Android `android.package = uz.voltai.app`. Matches the intended `uz.voltai.app`.
- **Export-compliance flag** — `ITSAppUsesNonExemptEncryption: false` set in `app.config.ts` iOS `infoPlist` (standard HTTPS/TLS only), so the App Store export-compliance prompt is skipped each submission.
- **Location usage strings present** — iOS `NSLocationWhenInUseUsageDescription` (foreground / "When In Use" only) is set; Android requests `ACCESS_COARSE_LOCATION` + `ACCESS_FINE_LOCATION`. The Yandex MapKit plugin also carries a matching when-in-use permission string. No background-location entitlement is requested (correct — the app only needs foreground location).
- **Account-free ⇒ no in-app account-deletion requirement** — the app has no sign-in and no server-side user records (settings live in on-device AsyncStorage; only `themePreference` today). Google Play's account-deletion / Data-deletion URL requirement and Apple's in-app account-deletion requirement do not apply. (You will still answer "no account" truthfully on the store forms — see B.)
- **Standalone release build is buildable** — `preview` produces an installable internal APK; `production` produces a Play `.aab`. (Note: both still need the runtime env — Yandex MapKit key and a reachable API — see B/C.)
- **Splash screen** configured (light + dark) via `expo-splash-screen`.

---

## (B) NEEDS THE OWNER / external actions before submission

- **Developer accounts (paid):**
  - Apple Developer Program — **$99 / year**.
  - Google Play Console — **$25 one-time**.
- **Google Play closed-testing gate (new personal accounts):** personal Play developer accounts created recently must run **closed testing with at least 20 testers, opted in for 14 continuous days**, before production access is granted. Budget ~2–3 weeks of lead time and recruit ~20 real testers early. (Organization accounts may be exempt — verify your account type.)
- **Host the privacy policy at a public HTTPS URL** — publish `store/privacy-policy.html`, then paste that URL into both stores. Fill the `PLACEHOLDER` effective date, contact email, and entity name first.
- **App Store Privacy "nutrition labels"** — declare: **Location — used, not linked to your identity, not used for tracking** (App Functionality). Everything else: not collected. No analytics, no ads, no third-party SDK data collection.
- **Google Play "Data safety" form** — declare: **Location — collected/used, on-device only, not shared, not linked to identity, no account.** No analytics, no ads, no data sold. Provide the privacy-policy URL.
- **Screenshots per required device sizes:**
  - Apple: 6.7"/6.9" iPhone and (**because `ios.supportsTablet` is currently `true`**) **iPad screenshots are REQUIRED**. Either produce iPad screenshots, or set `supportsTablet: false` in `app.json` to drop the iPad requirement (do this before building if you don't want to ship an iPad build).
  - Google Play: phone screenshots (min 2), plus a **512×512 icon** and a **1024×500 feature graphic**.
- **Content rating / age rating** — complete Apple's age-rating questionnaire and Google Play's **IARC** content-rating questionnaire (expected: everyone / low age — a maps utility with no objectionable content, no user-generated content, no purchases).
- **App metadata** — final name, subtitle, descriptions, keywords, categories, support URL (see `store-listing.md`); fill remaining `PLACEHOLDER`s.
- **Signing** — Android upload key / Play App Signing enrollment; iOS distribution certificate + provisioning (EAS can manage these).
- **Yandex MapKit key in the build environment** — `YANDEX_MAPKIT_API_KEY` / `EXPO_PUBLIC_YANDEX_MAPKIT_API_KEY` must be provided to the production build (they're read from env, not committed). Without a valid key the map won't initialize.

---

## (C) RISKS — can block, delay, or reverse a release

- **CRITICAL — no public production backend. The app cannot serve other users as configured.**
  - The stations client defaults to `https://api.voltai.uz` (`lib/stations/stationsClient.ts`), and the `production` EAS profile sets `EXPO_PUBLIC_API_BASE_URL=https://api.voltai.uz` — **but `api.voltai.uz` is currently returning HTTP 500 (Vercel).** A production build today would launch to an empty/failing map.
  - Worse, the checked-in `.env` and the `development`/`preview` profiles point at **`http://127.0.0.1:8080`**, which only resolves to the owner's own backend phone via `adb reverse`. Any build carrying that base URL works for **nobody but the owner**.
  - The current architecture is effectively **a phone acting as the backend** (the reverse-engineered operator data is served from the owner's device). **This fundamentally cannot serve distributed users** — it is not always-on, not scalable, and unreachable from the public internet.
  - **Required before public release:** stand up a real, always-on, publicly reachable production API (fix/redeploy `api.voltai.uz` or move off Vercel to a host that supports the long-running scraper workload), confirm it returns valid station + status data over HTTPS, and verify the production build actually points at it. Also note plaintext `http://` base URLs will be blocked by App Transport Security (iOS) / cleartext-traffic policy (Android) — production **must** be HTTPS.

- **Third-party data sourcing — store-policy rejection / takedown risk.**
  - Station locations and live availability are obtained by **reverse-engineering several operators' private app APIs**. This is the core legal/policy exposure:
    - **Apple App Store Review Guideline 5.2.2** (use of a third-party's service/data/API without authorization) can cause rejection or removal. **Guideline 5.2.1 / 5.2.5** (intellectual property) and **4.0/4.1** (design/copycat) are also in scope.
    - **Trademark & logo use** — operator names and logos are bundled (`assets/operators/*.png`, extracted from the operators' own apps). Displaying third-party trademarks/logos without permission risks IP complaints on both stores and DMCA-style takedowns.
    - **Google Play** equivalents: **Intellectual Property** policy and **Impersonation / Misrepresentation** can trigger the same rejection/removal.
  - **Mitigations to consider:** obtain permission or a data-sharing agreement from each operator; use only publicly documented/authorized endpoints where available; drop or replace unlicensed logos with neutral markers; add clear "unofficial / not affiliated" attribution; be ready for a takedown by keeping the operator set configurable server-side.

- **Operational fragility of scraped data.** Availability depends on undocumented endpoints (OTP login-replay etc.) that operators can change or block at any time — one operator (Megawatt) is already blocked. Expect intermittent gaps; the app should degrade gracefully (it already supports "only available" filtering and per-operator display), and the server should isolate one operator's failure from the rest.

- **Single API key exposure.** `EXPO_PUBLIC_*` values are embedded in the client bundle and are extractable. The Yandex MapKit key should be restricted (by bundle id / platform) in the Yandex console to limit abuse.
