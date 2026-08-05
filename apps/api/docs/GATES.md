# VoltAI — Gate checklist (do this BEFORE writing backend code)

Two things can sink the phone-as-backend plan. Prove them out first. See
[`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md) §9 for context.

- **Gate 1 — TLS interception:** can we actually decrypt station JSON from all 6 charger apps, no root?
- **Gate 2 — DNS/Cloudflare:** can `api.voltai.uz` be served from the phone through a tunnel?

---

## Gate 2 — Move `voltai.uz` DNS to Cloudflare  *(you must do this; ~15 min + propagation)*

**Current state (checked 2026-08-05):**
- `voltai.uz` nameservers = `rdns1/2/3.ahost.uz` (NOT Cloudflare).
- `api.voltai.uz` → Vercel (`…vercel-dns-017.com`).

A Cloudflare **named tunnel** can only publish `api.voltai.uz` if the **zone lives on Cloudflare**.
Moving nameservers moves the *whole* zone — but the website stays on Vercel; Cloudflare just becomes
the DNS host. Steps:

1. Create a free account at dash.cloudflare.com → **Add a site** → `voltai.uz`.
2. Cloudflare scans and imports the existing records. **Verify these came across and keep them:**
   - the apex `voltai.uz` and `www` records that point to **Vercel** (leave them **DNS only / grey cloud**),
   - any MX/TXT (email, verification) records.
3. Cloudflare shows **2 nameservers** (e.g. `x.ns.cloudflare.com`, `y.ns.cloudflare.com`).
   Log in to **ahost.uz** → domain `voltai.uz` → replace `rdns1/2/3.ahost.uz` with Cloudflare's two.
4. Wait for Cloudflare to show the zone **Active** (minutes–48 h; usually fast).
5. SSL/TLS → set encryption mode to **Full (strict)**.
6. Sanity: `nslookup -type=NS voltai.uz` returns the Cloudflare nameservers; the website still loads.

> The tunnel itself (`cloudflared tunnel …` + the Cache Rule on `/api/stations*`) is set up **later, on
> the phone**, in rollout Phase 5–6. It will replace only the `api.voltai.uz` record with the tunnel
> CNAME; the Vercel website records are untouched.

**Don't want to move DNS?** Then the alternatives are ngrok (paid custom domain) or a small VPS relay —
both discussed in `ARCHITECTURE.md` §3. Cloudflare is the free, cleanest path.

---

## Gate 1 — Prove no-root TLS interception on all 6 apps

### Step 0 — one-time tool setup
- `adb` — already installed here (`adb version` → 34.x). ✅
- **Java 17** for `apk-mitm` — the local Java is **8, too old**. Install Temurin 17:
  `winget install EclipseAdoptium.Temurin.17.JDK` (then reopen the shell so `java -version` shows 17).
- `apk-mitm` (no global install needed): run via `npx apk-mitm …`.
- **mitmproxy** for the runtime test: `pip install mitmproxy` (Python 3.12 is present). ✅

### Step 1 — install the apps + pull their APKs
Install the 6 apps on the phone normally (Play Store / APKPure) and **log in once each**. Then, with the
phone connected and USB debugging on:

```bash
cd apps/api
npm run gate:pull       # adb-pulls the 6 base APKs into ./tmp/apks
```

(The old `scrapers/apk/downloader.ts` APKPure path is **stale** — APKPure changed its pages. Pulling
from the phone gives the exact installed build and is what we use for the gate.)

### Step 2 — static pre-screen (no phone needed once pulled)
```bash
npm run gate:screen -- tmp/apks
```
For each app it prints framework (Flutter / React-Native / native), pinning signals, and a difficulty:
- **EASY** — `apk-mitm` alone should work.
- **MEDIUM** — pinning present; `apk-mitm` strips common pinning, else escalate to Frida.
- **HARD** — **Flutter**; ignores the user-CA store → needs **reFlutter** or a Frida BoringSSL hook even
  with no pinning. If it also enforces Play Integrity, that source is lost on-device
  → use the `scrapers/maps/{yandex,google}.ts` fallback for that operator.

This tells you *before touching the phone* how many of the 6 will be painful. **Expect 1–2 hard ones.**

### Step 3 — patch + reinstall (per app)
```bash
npx apk-mitm tmp/apks/tokbor.apk          # → tmp/apks/tokbor-patched.apk (user-CA trust + pinning strip + re-sign)
adb uninstall uz.tokbor.tokbor            # remove the original (different signature)
adb install tmp/apks/tokbor-patched.apk
# then re-login in the app (fresh data dir after re-sign)
```
For a **HARD (Flutter)** app, use reFlutter instead of / in addition to apk-mitm, or `objection patchapk`.

### Step 4 — runtime decrypt test (the actual gate)
Quickest validation is phone-proxied-through-PC mitmproxy (the on-device PCAPdroid path from
`ARCHITECTURE.md` is the *production* runtime; this just answers "does it decrypt at all"):

```bash
mitmweb --listen-port 8080     # on the PC; note the PC's LAN IP
```
On the phone: Wi-Fi → proxy → PC-IP:8080; browse `http://mitm.it` and install the mitmproxy CA as a
**user** cert. Open the **patched** app, pan/zoom the map, and watch mitmweb:

- ✅ **Station JSON appears decrypted** → app passes. Record its station-fetch URL (for `voltai_mitm.py`).
- ❌ **TLS handshake resets / app shows network error** → pinning or Flutter TLS survived → go to Step 3's
  escalation (objection / reFlutter). If nothing works → maps-scraper fallback for that source.

### Step 5 — record the result
Fill this in and keep it with the plan:

| app | framework | patched with | decrypts? | station URL | fallback needed |
|---|---|---|---|---|---|
| tokbor | | | | | |
| pro-tok | | | | | |
| spectre-energy | | | | | |
| megawatt-energy | | | | | |
| k-watt | | | | | |
| beon | | | | | |

**Gate 1 passes** if enough sources decrypt to be worth it; any that don't fall back to the off-device
map scrapers (lowest priority in the merge anyway). This table decides how much of the capture pipeline
is worth building.
