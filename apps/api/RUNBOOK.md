# VoltAI API — phone deployment runbook

How to run the API on an always-on Android phone (Termux) serving `https://api.voltai.uz`
via a Cloudflare Tunnel. See [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) for the why.

> **Status (verified 2026-08-15):** the API code + these scripts are validated on a dev machine
> (build + `node dist/src/index.js` serve the full contract). The Termux steps below have **not**
> been run end-to-end on a phone yet — validate on the device.

> ⚠️ **Reliability caveats before you commit a phone to this:**
> - **Android 15 is the riskiest OS** for this — it kills long-running Termux processes even
>   with wake-lock + battery-unrestricted (termux-app#5150). Prefer an **Android 12–14** device.
>   The device actually in hand is an **ASUS Zenfone 10 (AI2302) on Android 15** — i.e. the OS
>   this warns against. Until a replacement phone exists this is an *accepted* risk, so the
>   Android-15 mitigations are mandatory, not optional: phantom-process killing disabled,
>   Termux battery **Unrestricted**, `termux-wake-lock` held, and the external uptime check (§6).
> - A phone charging at 100 % 24/7 will swell its battery in 6–18 months. Use a smart-plug
>   charge schedule or a sacrificial device.
> - A single phone is a single point of failure. The external uptime check (§6) is mandatory,
>   and the cloud read-replica (ARCHITECTURE.md §6) is recommended before real traffic.

## Gate 2 — DNS (do first)
The named tunnel can only bind `api.voltai.uz` if the **voltai.uz zone is on Cloudflare**.
Today it's on ahost.uz. Move the nameservers to Cloudflare (keep the website's Vercel records).
Full steps: [`docs/GATES.md`](docs/GATES.md) §Gate 2.

**Still not done (re-checked 2026-08-15):** `voltai.uz` nameservers are `rdns1/2/3.ahost.uz`, and
`api.voltai.uz` is still a CNAME to `…vercel-dns-017.com` answering `HTTP 500
FUNCTION_INVOCATION_FAILED`. That 500 is structural, not a bug to chase — this API needs a
writable filesystem and a long-lived process, neither of which a Vercel function has. This gate is
the only thing between the code and a live `https://api.voltai.uz`.

## 1. Device prep
- Install **Termux + Termux:Boot + Termux:API from F-Droid** (not Google Play).
- Plug in permanently; Developer options → **Stay awake while charging**; set Termux (and
  Termux:Boot/API) battery to **Unrestricted** + OEM autostart allowed.
- `git clone <repo> ~/VoltAI`

## 2. Bootstrap
```bash
bash ~/VoltAI/apps/api/scripts/termux/bootstrap.sh
```
Installs nodejs-lts, cloudflared, termux-services, rclone; installs API deps + builds `dist/`.

Deps go in with `npm install --no-workspaces --omit=dev` (`bootstrap.sh:36`) — **not** `npm ci`.
`npm ci` cannot run in `apps/api`: there is no standalone lockfile there, because this is an npm
workspace and the lock lives at the repo root; `--no-workspaces` is what keeps the install from
dragging in the mobile app's Expo/RN tree. That `--omit=dev` path is the *pre-built-`dist/`* branch;
if `dist/src/index.js` is missing, `bootstrap.sh:32-37` installs the dev deps too and runs `tsc` on
the phone instead.

Faster: build `dist/` on a dev box first and copy it over — `bootstrap.sh` only runs `npm run
build` when `dist/src/index.js` is missing, so a pre-built `dist/` skips the slow, memory-hungry
on-device `tsc` entirely. **There is no `rsync`/`adb push` sync script in this repo**; move the
directory by hand. `scp` from the dev box into Termux (with `sshd` running) is the least painful;
note that plain `adb push` cannot write into Termux's private filesystem, so a cable copy has to
land in shared storage first and then be moved inside Termux.

## 3. Configure env
```bash
cp ~/VoltAI/apps/api/.env.example ~/VoltAI/apps/api/.env
# set at least:
#   INGEST_TOKEN=<random secret>
#   SQLITE_PATH=/data/data/com.termux/files/home/voltai/data/voltai.sqlite
#   AUTH_TOKENS_PATH=/data/data/com.termux/files/home/voltai/data/auth-tokens.json
#   TOKBOR_DETAILS_PATH=/data/data/com.termux/files/home/voltai/data/tokbor-details.json
#   CORS_ORIGINS=https://voltai.uz,https://www.voltai.uz
```

**Copy the two gitignored data files across — the phone is crippled without them.** Neither
`apps/api/data/auth-tokens.json` nor `apps/api/data/tokbor-details.json` is in git, so a fresh
`git clone` on the phone does not have them:
```bash
# from the dev box, then move them into $HOME/voltai/data/ on the phone
# (same transfer problem as dist/ — use the scp route described in §2)
#   auth-tokens.json     — the operator login-replay bearer tokens (Tokbor, Beon, Pro-Tok)
#   tokbor-details.json  — the per-station Tokbor name/price cache
chmod 600 ~/voltai/data/auth-tokens.json
```
Without `auth-tokens.json` the phone loses **Tokbor and Beon entirely — 766 of 1,226 canonical
stations**; without `tokbor-details.json` the surviving Tokbor pins lose their names and prices.
Point `AUTH_TOKENS_PATH` and `TOKBOR_DETAILS_PATH` at them (above) so all three files live
together under `$HOME/voltai/data/` — otherwise the code falls back to `./data/` relative to the
process CWD.

No seeding step is needed: MongoDB/Atlas is retired and there is no export to restore from. The
API populates itself — it fires one scrape immediately on boot (`src/index.ts:22-24`) and then
every 3–5 minutes, so a fresh phone is serving real data within one cycle. `/ingest` stays
available for pushing off-device map-scraper results, but it is not how the phone gets its data.

## 4. Cloudflare tunnel
```bash
cloudflared tunnel login                 # pick the voltai.uz zone
cloudflared tunnel create voltai-api     # writes ~/.cloudflared/<UUID>.json
cp ~/VoltAI/apps/api/scripts/cloudflared/config.example.yml ~/.cloudflared/config.yml
#   edit ~/.cloudflared/config.yml → fill <TUNNEL-UUID>
cloudflared tunnel route dns voltai-api api.voltai.uz   # replaces the Vercel CNAME
```
**Caching (edge + freshness) — the Cache Rules are REQUIRED, not a backstop.** The origin does
send its own `Cache-Control` + `ETag` / `Last-Modified` on the read endpoints, but that alone
caches **nothing**: Cloudflare decides cache *eligibility* from the URL's file extension and
content type, and extensionless `application/json` paths like `/api/stations/statuses` are
treated as dynamic and bypassed no matter what `s-maxage` the origin sends. Without an explicit
Cache Rule the edge absorbs zero traffic and every client poll lands on the phone — which is
exactly the failure mode ARCHITECTURE.md calls the edge cache mandatory to prevent. Create these
rules (Caching → Cache Rules, action **Cache eligibility = Eligible for cache**):
- `api.voltai.uz/api/stations*` (covers `/nearby`, `/search`, `/:id`) — the full catalog changes
  slowly; edge TTL ~180s, `stale-if-error` 7d. Respects the origin's `s-maxage` (default 180s).
- `api.voltai.uz/api/stations/statuses` — the **live status feed** other apps poll; short edge
  TTL ~30s so a fresh scrape is visible within ~30s, `stale-if-error` 1h. Respect origin headers.
- `api.voltai.uz/api/plan*` — plan responses are the most expensive thing the phone computes;
  respect the origin's `PLAN_CACHE_*` / `PLAN_LIVE_CACHE_*` headers.
- Do **not** cache `/api/health*` or `/ingest`.

**Verify every rule after the cutover** — a rule that silently doesn't match looks identical to
no rule at all until the phone falls over:
```bash
curl -sI https://api.voltai.uz/api/stations | grep -i cf-cache-status   # want: HIT (2nd request)
```
`DYNAMIC` means the rule is not matching and the phone is taking the full load.

Consumers should fetch `/api/stations` once for the catalog, then poll `/api/stations/statuses`
(send back the `ETag` as `If-None-Match` → cheap 304s). Two things to know about that advice:
- **The origin does not compress.** There is no compression middleware and no `compression`
  dependency, so the catalog goes out uncompressed — measured `Content-Length: 243578` with no
  `Content-Encoding`, even when the client sends `Accept-Encoding: gzip, br`. "~24 KB gzipped" is
  what it *would* be; getting there means either enabling compression at the Cloudflare edge or
  adding the middleware at the origin.
- **The `ETag` changes on every scrape whether or not the data changed**, because it is keyed on
  `lastMergeAt`, which `stationRepo.ts:171` stamps unconditionally at the end of every merge. So
  `If-None-Match` saves bytes *between* scrapes, never across one.

This split is still what keeps the single phone CPU from being the capacity plane while serving
near-real-time statuses. Tune TTLs via `STATIONS_CACHE_*` / `STATUSES_CACHE_*` env (see
`.env.example`).

## 5. Run under supervision + autostart
```bash
bash ~/VoltAI/apps/api/scripts/termux/install-services.sh   # runit services: voltai-api + cloudflared
ln -s ~/VoltAI/apps/api/scripts/termux/boot.sh ~/.termux/boot/00-voltai && chmod +x ~/.termux/boot/00-voltai
# launch the Termux:Boot app once so its boot receiver registers
```
Control: `sv up|down|restart voltai-api cloudflared`. Logs: `~/voltai/logs/{api,cloudflared}/current`.
`boot.sh` holds `termux-wake-lock` before handing off to `runsvdir`, so the CPU/Wi-Fi stay awake.

⚠️ **The API listens on all interfaces, not just loopback** — `src/index.ts:13` is
`app.listen(port, …)` with no host argument, so anything on the phone's Wi-Fi can reach port 8080
directly, **including `/ingest`**, bypassing the cloudflared ingress rules entirely. Until that is
changed, treat the phone's network as trusted-only: don't park it on café/guest Wi-Fi, and keep
`INGEST_TOKEN` a real secret — on the LAN it is the *only* thing standing in front of `/ingest`.

## 6. Monitoring & backup
- **External** uptime check on `https://api.voltai.uz/api/health` (UptimeRobot/BetterStack) →
  Telegram. This is the only thing that catches Android killing the whole process.
- Data freshness: `GET /api/health/detail` exposes `lastScrapeAt`, `secondsSinceLastScrape`,
  a `stale` boolean (true when > `STATIONS_STALE_AFTER_SEC`, default 900s), `lastIngestAt` per
  source, and `lastMergeAt`. **Alert on `stale:true`** — it catches a scheduler that has silently
  stopped ticking (e.g. Android froze the process) even while HTTP still answers `/api/health`.
  The scrape reschedules itself a random **3–5 min after each run completes**
  (`SCRAPE_MIN_MINUTES` / `SCRAPE_MAX_MINUTES` — `src/index.ts:97-126`; the gap is randomized for
  anti-fingerprinting and runs never overlap), so a healthy phone stays well under 900s.
- ⚠️ **`stale` detects a STOPPED SCHEDULER ONLY — it is not a data-quality alarm.** `lastScrapeAt`
  is stamped unconditionally at the end of every cycle (`src/index.ts:67`), even when every source
  failed, so `stale` stays `false` while the loop happily churns over an empty scrape. To catch
  dead sources, **also alert on the per-source `lastIngestAt` values** in the same payload: each
  live source should advance every few minutes, and one that stops advancing has lost its token,
  been blocked, or changed its API.
- Watchdog: register `scripts/termux/watchdog.sh` as a **third runit service**. A hand-typed
  `while true; do bash …/watchdog.sh; sleep 120; done` loop dies with the Termux session that
  started it, so the local self-heal does *not* survive unattended operation — which is the only
  situation it exists for. Add a `voltai-watchdog` entry to `install-services.sh` next to
  `voltai-api`/`cloudflared` (a `run` file that loops the script with a 120s sleep), then control
  it with `sv up|down|restart voltai-watchdog`.
  ⏳ **NOT BUILT (2026-08-15)** — `install-services.sh` registers only `voltai-api` and
  `cloudflared`.
- Backup: ✅ **IMPLEMENTED (2026-08-15) — `scripts/termux/backup.sh` + `restore.sh`.** A hot copy of
  the SQLite DB (via the SQLite online-backup API, with a `PRAGMA integrity_check` gate) plus
  `auth-tokens.json` and `tokbor-details.json` are packed into one gzipped tar with a
  `sha256sum` + row-count manifest, uploaded with `rclone`, and both local and remote copies older
  than `BACKUP_RETENTION_DAYS` (default 14) are pruned. `install-services.sh` registers it as the
  `voltai-backup` runit service, which fires nightly at ~03:00; `bootstrap.sh` now installs the
  `sqlite` CLI it needs. **To arm it:** run `rclone config` once to create a remote (e.g. a
  Cloudflare R2 bucket), set `BACKUP_REMOTE=<remote>:<bucket>` in `.env`, then
  `bash scripts/termux/backup.sh` for a first run. With `BACKUP_REMOTE` blank the job no-ops loudly
  (backups disabled). Restore the newest archive with `bash scripts/termux/restore.sh` (it verifies
  checksums + DB integrity and saves whatever is currently on disk to `*.pre-restore-<stamp>` first).
  The `data/auth-tokens.json` tokens and accumulated `raw_stations` history are **not** rebuildable
  by the scrapers, so this backup is the only thing standing between a dropped phone and re-doing
  every operator login by hand — arm it before launch.

## Rollback
DNS-level: repoint the `api.voltai.uz` record. The procedure assumes a previous origin kept warm
until the phone has a few days of clean uptime + a backup you have actually restored once. The
backup tooling now exists (§6), but it is only real once `BACKUP_REMOTE` is set and a
`restore.sh` dry run has succeeded — do that before relying on rollback (see the caveat below).

**Caveat (2026-08-15): there is no warm origin today.** The record that `tunnel route dns`
replaces points at the retired Vercel function, which answers `HTTP 500
FUNCTION_INVOCATION_FAILED` — rolling back to it restores an outage, not a service. Deleting
`apps/api/vercel.json` + `apps/api/api/index.ts` (so that function can never redeploy) is
**still outstanding**; do it deliberately, and understand that once it is done the only rollback
target is a second phone or the deferred cloud read-replica (ARCHITECTURE.md §6) — restored from
the §6 backups, which you must arm (`BACKUP_REMOTE`) and test-restore at least once before launch.
