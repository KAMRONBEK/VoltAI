# VoltAI — Remaining launch gate: DNS

> **Read this first (2026-08-15).** The backend is already written — this is no longer a
> "before you write code" checklist.
>
> - **Gate 1 — TLS interception: RUN 2026-08-06, FAILED as designed, and SUPERSEDED.** The capture
>   phone is an ASUS Zenfone 10 (AI2302) on **Android 15, no root**, and the operator apps are
>   **Flutter with cert pinning**; reFlutter crashed tokbor (SIGSEGV in `libflutter.so`). On-device
>   capture is **abandoned**. The shipped approach is **off-device HTTP scraping** of each operator's
>   own reverse-engineered API, called in-process by the API — see
>   [`SCRAPERS.md`](SCRAPERS.md). Everything below the Gate 1 heading is kept **for history only**;
>   the `gate:pull` / `gate:screen` scripts documented there are still live, because that is how APKs
>   are pulled and screened for endpoint extraction.
> - **Gate 2 — DNS/Cloudflare: still OPEN, and now the only gate.** Can `api.voltai.uz` be served
>   from the phone through a tunnel?

See [`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md) §9 for why, and
[`../RUNBOOK.md`](../RUNBOOK.md) for how the phone is deployed once this gate clears.

---

## Gate 2 — Move `voltai.uz` DNS to Cloudflare  *(you must do this; ~15 min + propagation)*

**Current state (re-verified live 2026-08-15 — unchanged since 2026-08-05):**
- `voltai.uz` nameservers = `rdns1/2/3.ahost.uz` (NOT Cloudflare).
- `api.voltai.uz` → still a CNAME to Vercel (`1ff6f9e69f1bd742.vercel-dns-017.com`), returning
  **HTTP 500 `FUNCTION_INVOCATION_FAILED`**. That is structural, not a bug to fix: the API now needs
  a writable filesystem and a long-lived process, which a Vercel function cannot give it.

A Cloudflare **named tunnel** can only publish `api.voltai.uz` if the **zone lives on Cloudflare**.
Moving nameservers moves the *whole* zone — but the website stays on Vercel; Cloudflare just becomes
the DNS host. Steps:

0. **Export the zone from ahost.uz FIRST.** Cloudflare's import is a *guess-scan*, not a zone
   transfer: it can only find records whose names it thinks to query. Anything it doesn't guess —
   most importantly **DKIM selectors**, which have unguessable names like `s1._domainkey` — is
   silently dropped, and email starts failing signature checks after the cutover with nothing in the
   UI to show what went missing. Get the zone file (or a full record list) out of ahost.uz before
   touching anything.
1. Create a free account at dash.cloudflare.com → **Add a site** → `voltai.uz`.
2. Cloudflare scans and imports the existing records. **Check every one of these came across, and
   diff the result against the zone you exported in step 0** (measured inventory, 2026-08-15):

   | name | type | value |
   |---|---|---|
   | `voltai.uz` (apex) | A | `76.76.21.21` (Vercel) — keep **DNS only / grey cloud** |
   | `www` | CNAME | `voltai.uz` — keep **DNS only / grey cloud** |
   | `api` | CNAME | `1ff6f9e69f1bd742.vercel-dns-017.com` — this is the one the tunnel replaces |
   | `mail` | CNAME | `voltai.uz` |
   | `voltai.uz` | MX | pref `0` → `voltai.uz` |
   | `voltai.uz` | TXT (SPF) | `v=spf1 +a +mx +ip4:185.196.212.52 ~all` |
   | `_dmarc` | TXT | `v=DMARC1; p=none;` |

   Any DKIM selector in your export but not in this table must be re-created by hand.
3. Cloudflare shows **2 nameservers** (e.g. `x.ns.cloudflare.com`, `y.ns.cloudflare.com`).
   Log in to **ahost.uz** → domain `voltai.uz` → replace `rdns1/2/3.ahost.uz` with Cloudflare's two.
4. Wait for Cloudflare to show the zone **Active** (minutes–48 h; usually fast).
5. SSL/TLS → set encryption mode to **Full (strict)** — but note this **only applies to PROXIED
   (orange-cloud) records**. Keep the apex and `www` **DNS-only / grey cloud** so **Vercel** keeps
   terminating TLS for the website: Vercel's certificate is `CN=voltai.uz` with **no `www` SAN**, so
   proxying `www` under Full (strict) would fail origin validation and take the site down.
6. Sanity: `nslookup -type=NS voltai.uz` returns the Cloudflare nameservers; the website still loads;
   send yourself a test email to confirm SPF/DKIM/DMARC still pass.

> The tunnel itself (`cloudflared tunnel …` + the Cache Rule on `/api/stations*`) is set up **later, on
> the phone** — see [`../RUNBOOK.md`](../RUNBOOK.md) §4. It will replace only the `api.voltai.uz`
> record with the tunnel CNAME; the Vercel website records are untouched.

**Don't want to move DNS?** Then the alternatives are ngrok (paid custom domain) or a small VPS relay —
both discussed in `ARCHITECTURE.md` §3. Cloudflare is the free, cleanest path.

---

## Gate 1 — Prove no-root TLS interception on all 6 apps *(historical — superseded)*

> **CLOSED 2026-08-06 with a NO.** This gate was run exactly as written below and it answered the
> question it was built to answer: no-root, on-device TLS interception is not achievable on this
> device. The design it guarded (§5.1/§5.2 of `ARCHITECTURE.md` — apk-mitm + PCAPdroid + mitmdump)
> was dropped, not retried. **The live data path is now off-device HTTP scraping of the operators'
> own APIs — [`SCRAPERS.md`](SCRAPERS.md) is the source of truth.**
>
> Two things in this section are still current and still used: `npm run gate:pull` (Step 1) and
> `npm run gate:screen` (Step 2). They are how APKs are pulled off the phone and screened, which is
> how the endpoints in `SCRAPERS.md` were extracted in the first place. Steps 3–4 (patching and the
> runtime decrypt test) are dead.

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
*(Actual result: **5 of 6 came back HARD/Flutter**, and the sixth was blocked by attestation rather
than TLS — see Step 5.)*

### Step 3 — patch + reinstall (per app)
```bash
npx apk-mitm tmp/apks/tokbor.apk          # → tmp/apks/tokbor-patched.apk (user-CA trust + pinning strip + re-sign)
adb uninstall uz.tokbor.tokbor            # remove the original (different signature)
adb install tmp/apks/tokbor-patched.apk
# then re-login in the app (fresh data dir after re-sign)
```
For a **HARD (Flutter)** app, use reFlutter instead of / in addition to apk-mitm, or `objection patchapk`.

### Step 4 — runtime decrypt test (the actual gate)
Quickest validation is phone-proxied-through-PC mitmproxy (at the time, the on-device PCAPdroid path
in `ARCHITECTURE.md` §5.2 was meant to be the *production* runtime — **that pillar was abandoned, so
nothing here is production any more**; this step just answered "does it decrypt at all"):

```bash
mitmweb --listen-port 8080     # on the PC; note the PC's LAN IP
```
On the phone: Wi-Fi → proxy → PC-IP:8080; browse `http://mitm.it` and install the mitmproxy CA as a
**user** cert. Open the **patched** app, pan/zoom the map, and watch mitmweb:

- ✅ **Station JSON appears decrypted** → app passes. Record its station-fetch URL (for `voltai_mitm.py`).
- ❌ **TLS handshake resets / app shows network error** → pinning or Flutter TLS survived → go to Step 3's
  escalation (objection / reFlutter). If nothing works → maps-scraper fallback for that source.

### Step 5 — record the result  *(filled in 2026-08-06)*

| app | framework | patched with | decrypts? | station URL | fallback needed |
|---|---|---|---|---|---|
| tokbor | Flutter (pinned — bundles `assets/certs/api.newtokbor.uz.pem`) | reFlutter → **app crashed, SIGSEGV in `libflutter.so`** | ❌ | `https://api.newtokbor.uz/charging-station` | yes → off-device API scrape |
| pro-tok | Flutter | not attempted — gate abandoned after tokbor | ❌ | `https://crm.protok.uz/api/Connector/List` | yes → off-device API scrape |
| spectre-energy | Flutter | not attempted | ❌ | `https://api.spectre-energy.uz/api/v2/station/statuses/` | yes → off-device API scrape (no auth) |
| megawatt-energy | React Native | n/a — TLS was never the wall | n/a — never attempted | `https://megawatt-app.ecofactortech.com/api/client/charge-box` | **none works** — hardware attestation |
| k-watt | Flutter | not attempted | ❌ | `https://app.k-watt.uz/api/v1/core/charge-point-list/` | yes → off-device API scrape (no auth) |
| beon | Flutter | not attempted | ❌ | `https://api.v2.beon-app.com/map` | yes → off-device API scrape |

**Outcome: Gate 1 FAILED — zero of six decrypted on-device**, so no part of the capture pipeline was
built. Flutter ignores the user-CA store, five of the six apps are Flutter, and the sixth (megawatt) is
walled by hardware attestation rather than by TLS at all. The station URLs above were recovered
**statically**, out of the shipped APKs (`libapp.so` `.rodata` for Flutter,
`assets/index.android.bundle` for React Native) — which is what made the replacement design possible.

**What replaced it:** the API calls each of those URLs itself, in-process, with no phone in the
request path. Live status, auth recipes and current station counts all live in
[`SCRAPERS.md`](SCRAPERS.md) — as of 2026-08-15: Tokbor ✅, Spectre ✅, K-Watt ✅, Beon ✅
(1,226 canonical stations), Pro-Tok 🟡 pending a one-time OTP login, Megawatt ⛔ blocked by hardware
attestation. The `scrapers/maps/{yandex,google}.ts` map scrapers survive as an off-device fallback
only, not as the primary path.
