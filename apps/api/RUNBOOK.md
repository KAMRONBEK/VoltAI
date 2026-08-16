# VoltAI API — phone deployment runbook

How to run the API (+ its in-process scrapers + the SQLite database) on an always-on Android phone
in Termux, and expose it as `https://api.voltai.uz` through a Cloudflare Tunnel.
Why it is built this way: [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md).

> **Status (2026-08-16):** the phone actually in service is the ASUS Zenfone 10 (AI2302, Android 15).
> Everything in §1–§3 and §5–§7 has been run on it end-to-end over ssh (deploy, supervision, boot
> hook, backup + restore drill, smoke test, and an **unattended reboot test: `adb reboot` → API,
> tunnel, watchdog and sshd all back and `ready` after 60 s with nobody touching the phone**).
> Cloudflare side (same day, via API): zone `voltai.uz` created with every ahost.uz record incl.
> DKIM, tunnel `voltai-api` (remotely-managed, token on the phone, connector **healthy**),
> `api` → tunnel CNAME (proxied), SSL Full (strict), Always-HTTPS, Cache Rules on
> `/api/stations*`, `/api/plan*`, `/api/client-config` (never `/api/health*`, `/ingest`), rate
> limit 20 req/10 s per IP on `/api/plan*`. **The nameserver switch at ahost.uz was submitted; the
> zone goes Active once the .uz registry publishes `carmelo/lauryn.ns.cloudflare.com`.**

## Reliability caveats — read before you trust a phone with this
- **Android 15 kills long-running Termux processes** even with wake-lock + battery-unrestricted
  (termux-app#5150). The mitigations in §1 are therefore mandatory, not optional.
- **A lock-screen PIN blocks unattended reboots.** Termux's storage is credential-encrypted and
  Termux:Boot only fires after the *first unlock*. With a PIN/pattern set, every reboot needs a human
  to unlock once before the API comes back. Set **Screen lock = None/Swipe** on the server phone.
- A phone charging at 100 % 24/7 swells its battery in 6–18 months. Prefer a smart-plug charge
  schedule or ASUS Battery Care's charge cap.
- A single phone is a single point of failure. The external readiness check (§6) is mandatory; the
  cloud read-replica (ARCHITECTURE.md §6) is recommended before real traffic.

## Gate 2 — DNS (owner action, do first when going public)
The named tunnel can only bind `api.voltai.uz` if the **voltai.uz zone is on Cloudflare**. Today it is
on ahost.uz and `api.voltai.uz` is a CNAME to a retired Vercel deployment answering HTTP 500 — that 500
is structural (the API needs a writable disk and a long-lived process), not a bug to chase.
Full steps: [`docs/GATES.md`](docs/GATES.md) §Gate 2.

## 1. Device prep (once, on the phone)
- Install **Termux + Termux:Boot + Termux:API from F-Droid** (not Google Play).
- Open the **Termux:Boot app once** (registers its BOOT_COMPLETED receiver).
- Settings → Apps → Termux / Termux:Boot / Termux:API → **Battery → Unrestricted**; ASUS Mobile
  Manager → **Auto-start allowed**.
- Settings → Security → **Screen lock → None or Swipe** (see caveats). Developer options → **Stay
  awake while charging**; disable **Auto-install system updates**.
- Android 12+ phantom-process killer, via adb from a PC (the `settings put` persists across reboots;
  the `device_config` pair persists only with sync disabled):
  ```bash
  adb shell "/system/bin/device_config set_sync_disabled_for_tests persistent"
  adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"
  adb shell "settings put global settings_enable_monitor_phantom_procs false"
  adb shell "dumpsys deviceidle whitelist +com.termux"   # + com.termux.boot, com.termux.api
  ```
  (Alternative without adb: Developer options → *Disable child process restrictions*.)
- In Termux: `pkg install git openssh && git clone https://github.com/KAMRONBEK/VoltAI ~/VoltAI`, put
  the dev box's ssh public key in `~/.ssh/authorized_keys`, run `sshd`. From the PC:
  `adb forward tcp:8022 tcp:8022 && ssh -p 8022 -i ~/.ssh/voltai_phone u0_a232@127.0.0.1` (the user
  name is Termux's uid — `whoami` in Termux). Everything below is done over that ssh session.

## 2. Bootstrap (once)
```bash
bash ~/VoltAI/apps/api/scripts/termux/bootstrap.sh
```
Installs `nodejs-lts git termux-services termux-api cloudflared rclone sqlite openssh openssl-tool curl`,
creates `~/voltai/{data,logs,backups,state}`, writes `apps/api/.env` from `.env.example` with **absolute
phone paths** and a random `INGEST_TOKEN`, generates the **backup passphrase**
(`~/voltai/backup.passphrase` — copy it somewhere off the phone; archives are unreadable without it),
and enables `sshd`. It does **not** build anything: `dist/` is built on the dev box and shipped by
`deploy.sh` (tsc on the phone is slow, and the workspace's node_modules would be huge).

Then fill in `~/VoltAI/apps/api/.env`: **`MYTAXI_API_KEY`** (route planner; without it every plan is
straight-line "estimated") and, once `rclone config` has a remote, **`BACKUP_REMOTE`**.

## 3. Deploy / redeploy

**Automatic (push-to-deploy):** every push to `main` runs CI (`.github/workflows/ci.yml`); when the
checks pass, CI builds the API and publishes it as a GitHub Release `api-<shortsha>` (bundle +
sha256). On the phone the `voltai-updater` service polls the latest release every 5 min, verifies
the checksum, and runs `apply-update.sh`: snapshot the current build → copy the bundle in → `npm ci
-w voltai-api --omit=dev` if the lockfile changed → move the git checkout to that commit → `sv
restart voltai-api` → `smoke.sh` → **roll back to the snapshot on any failure** (that release is then
never retried). Only forward moves are applied (the release must descend from the installed commit),
and a *dirty* manual deploy pauses auto-update until a committed build is deployed. Freeze the phone
with `AUTO_UPDATE=false` in `.env` (+ `sv restart voltai-updater`). Log:
`~/voltai/logs/updater/current`; last result: `~/voltai/state/last-update`. Push → phone typically
within 5–8 minutes (CI ~1 min + poll interval).

**Manual (from the dev box — uncommitted work, first install, or when in a hurry):**
```bash
bash apps/api/scripts/phone/deploy.sh --data     # first time: also copies auth-tokens.json + tokbor-details.json
bash apps/api/scripts/phone/deploy.sh            # any later deploy (same apply-update.sh path as CI)
bash apps/api/scripts/phone/deploy.sh --setup    # also (re)run install-services.sh + install-boot.sh
```
It builds locally (`dist/version.json` commit stamp), ships the identical bundle over ssh and calls
`apply-update.sh` on the phone. `/api/health/detail` reports `build.commit`, so a stale phone is
visible from anywhere.

**Data files** (`~/voltai/data/`, NOT in git — the phone holds the only copies): `auth-tokens.json`
(operator login-replay bearers; without it Tokbor + Beon — ~766 of ~1,226 stations — disappear) and
`tokbor-details.json` (Tokbor names/prices). `deploy.sh --data` copies them if the phone has none;
`--force-data` overwrites (e.g. after `npm run auth:tokbor` / `npm run enrich:tokbor` on the dev box).
`/api/health/detail → auth` shows per-source token presence and **JWT expiry** (`daysLeft`).

## 4. Cloudflare Tunnel (owner: needs the Cloudflare account; after Gate 2)
Two ways; the runit service supports both and prefers the first:

**A. Remotely-managed (recommended — no browser login on the phone).** Zero Trust dashboard →
Networks → Tunnels → *Create a tunnel* (Cloudflared) → name `voltai-api` → copy the connector
**token** → on the phone `mkdir -p ~/.cloudflared && printf '%s' '<token>' > ~/.cloudflared/token && chmod 600 ~/.cloudflared/token`
→ back in the dashboard add a **Public hostname**: `api.voltai.uz` → `http://127.0.0.1:8080` (this
creates/overwrites the DNS record). Then `sv-enable cloudflared`.

**B. Locally-managed.** `cloudflared tunnel login` (opens a URL — complete it on any browser),
`cloudflared tunnel create voltai-api`, copy `scripts/cloudflared/config.example.yml` to
`~/.cloudflared/config.yml` and fill in the UUID, `cloudflared tunnel route dns --overwrite-dns
voltai-api api.voltai.uz` (the record already exists, hence `--overwrite-dns`), `sv-enable cloudflared`.

**Cache Rules are REQUIRED, not a backstop.** Cloudflare decides cache eligibility from the URL's
extension/content type, and extensionless `application/json` is bypassed no matter what
`Cache-Control` the origin sends. Without these rules every client poll lands on the phone. Caching →
Cache Rules, action *Eligible for cache*, respecting origin headers:
- `api.voltai.uz/api/stations*` (catalog + `/statuses` + `/:id`) — origin sends `s-maxage` 180 s /
  30 s and `stale-if-error`.
- `api.voltai.uz/api/plan*` and `api.voltai.uz/api/client-config`.
- Do **not** cache `/api/health*` or `/ingest`.

Also add a **Rate Limiting rule** on `api.voltai.uz/api/plan*` (e.g. 60 requests / min per IP — the
origin enforces the same via `PLAN_RATE_PER_MIN`, but the edge should absorb the burst).

Verify after cutover:
```bash
curl -sI https://api.voltai.uz/api/stations | grep -i cf-cache-status      # 2nd request: HIT
curl -s  https://api.voltai.uz/api/health/ready                            # {"status":"ready",...}
bash apps/api/scripts/smoke.sh https://api.voltai.uz
```
`/ingest` is refused by the API itself for any request that arrived through the tunnel or from a
non-loopback peer, on top of the ingress rule and the token.

## 5. Supervision + boot (once; `deploy.sh --setup` runs both)
```bash
bash ~/VoltAI/apps/api/scripts/termux/install-services.sh   # runit: voltai-api, voltai-watchdog, voltai-backup, cloudflared, sshd
bash ~/VoltAI/apps/api/scripts/termux/install-boot.sh       # ~/.termux/boot/00-voltai → wake-lock + service-daemon start
```
- `voltai-api` — `node dist/src/index.js` in `apps/api` (reads `.env` itself; binds `127.0.0.1:8080`;
  clears a stale SQLite lock left by an unclean kill; closes cleanly on SIGTERM).
- `voltai-watchdog` — every 2 min: re-asserts `termux-wake-lock`, restarts the API only after **3
  consecutive** liveness misses (a merge can block the event loop for seconds), logs readiness, and
  restarts `cloudflared` only if the tunnel is configured, has been up > 5 min, the uplink works and
  the public URL failed 3× (max once / 15 min).
- `voltai-backup` — 03:00 nightly (§6). `voltai-updater` — pull-based CD (§3). `cloudflared` —
  stays **down** until `~/.cloudflared/token` or `config.yml` exists (`sv-enable cloudflared` after §4).
- Control: `sv status|up|down|restart <svc>`. Logs: `~/voltai/logs/{api,watchdog,backup,cloudflared}/current`.
- **Reboot test (mandatory before relying on it):** `adb reboot`; with no lock-screen PIN, within
  ~2 min `curl http://127.0.0.1:8080/api/health/ready` (over `adb forward`) must answer 200 without
  anyone touching the phone. With a PIN, it answers only after the first unlock.

## 6. Monitoring, backup, restore
- **External readiness check** (UptimeRobot/BetterStack, from off the phone) on
  `https://api.voltai.uz/api/health/ready` — it answers **503** when the catalog is empty, when the DB
  is not a real file (misconfigured `SQLITE_PATH`), or when the scrape scheduler is stale. This is the
  only thing that catches Android killing the whole process. Alert → Telegram.
- **`/api/health/detail`** — `build.commit`, `dbPath`, `stale` (scheduler), and per-source
  `sources.<name>.state` (`fresh|stale|never|no-login|disabled`) with `lastError`, plus `auth.<name>`
  (`hasToken`, `expiresAt`, `daysLeft`, `lastRejectedAt`). Alert on any `sources.*.stale` — that is
  the "one operator silently died" signal the scheduler-level `stale` cannot see.
- **Data honesty in the API itself:** connector statuses from a raw row older than
  `STATUS_MAX_AGE_SEC` (1 h) are served as `unknown`; raw rows older than `STATION_TTL_DAYS` (7) are
  dropped from the map; rows unseen for `RAW_RETENTION_DAYS` (30) are deleted.
- **Backup** — the API writes a consistent `VACUUM INTO` snapshot daily at 02:30
  (`~/voltai/data/snapshots/voltai-snapshot.sqlite`, and once after boot); `backup.sh` (03:00) packs
  it with `auth-tokens.json`, `tokbor-details.json`, `.env`, `~/.cloudflared/*` and `rclone.conf` into
  an **encrypted** archive (`~/voltai/backups/voltai-<stamp>.tar.gz.enc` + `.sha256`), copies it to
  shared storage `~/storage/shared/VoltAI-backups/` and, if `BACKUP_REMOTE` is set, to the rclone
  remote; 14-day retention everywhere. Never copies the live DB while the API runs (the sqlite3 CLI's
  POSIX locks and node-sqlite3-wasm's directory locks are invisible to each other).
  Run by hand: `bash scripts/termux/backup.sh`.
- **Restore** — `bash scripts/termux/restore.sh [--dry-run|--db-only] [archive]`: verifies checksums +
  `integrity_check`, stops the API, removes any old `-journal`/`.lock`, puts files in place (keeping
  `*.pre-restore-<stamp>`), starts the API, prints `/api/health/ready`. **Do one `--dry-run` and one
  real restore into a scratch `SQLITE_PATH` before launch** so the passphrase and procedure are proven.
- **Client control channel** — `GET /api/client-config` (`CLIENT_MIN_VERSION`, `CLIENT_MESSAGE`,
  `CLIENT_MAINTENANCE` in `.env` + `sv restart voltai-api`) is read by the app at launch (fail-open):
  the only way to tell installed apps about maintenance or a must-upgrade.

## 7. Everyday operations
| Task | Command |
|---|---|
| Ship a code change | push to `main` (CI publishes → phone auto-updates within ~5–8 min); or `bash apps/api/scripts/phone/deploy.sh` for a manual/uncommitted deploy |
| Freeze / unfreeze auto-updates | `AUTO_UPDATE=false` / `true` in `.env`, then `sv restart voltai-updater` |
| Last auto-update result | `cat ~/voltai/state/last-update`; `tail ~/voltai/logs/updater/current` |
| See what is running | `curl -s 127.0.0.1:8080/api/health/detail \| head -c 600` (phone) |
| Full check | `bash apps/api/scripts/smoke.sh http://127.0.0.1:8080` |
| Restart / stop | `sv restart voltai-api` / `sv down voltai-api` |
| Tail logs | `tail -f ~/voltai/logs/api/current` |
| Renew an operator login (dev box) | `npm run auth:tokbor -- send "+998…"` → `-- verify <code>`, then `deploy.sh --force-data` |
| Refresh Tokbor names/prices (dev box) | `npm run enrich:tokbor`, then `deploy.sh --force-data` |
| Maintenance notice to apps | set `CLIENT_MESSAGE=` / `CLIENT_MAINTENANCE=true` in `.env`, `sv restart voltai-api` |
| Backup now / restore drill | `bash scripts/termux/backup.sh` / `bash scripts/termux/restore.sh --dry-run` |

## Rollback
- **Code:** `deploy.sh` is idempotent — check out the previous commit on the dev box and deploy it
  (`dist/version.json` / `/api/health/detail → build.commit` confirms). Data files are untouched.
- **Data:** `restore.sh` from the newest good archive (see §6).
- **DNS-level:** there is **no warm origin** to fall back to today (the old record is the 500-ing
  Vercel function, whose entrypoint has now been deleted from the repo). Until the cloud read-replica
  exists (ARCHITECTURE.md §6), the rollback target for a dead phone is a second phone restored from
  the §6 backup — which is why the passphrase and a proven restore matter.
