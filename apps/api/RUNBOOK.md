# VoltAI API — phone deployment runbook

How to run the API on an always-on Android phone (Termux) serving `https://api.voltai.uz`
via a Cloudflare Tunnel. See [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) for the why.

> **Status:** the API code + these scripts are validated on a dev machine (build + `node
> dist/src/index.js` serve the full contract). The Termux steps below have **not** been run
> end-to-end on a phone yet — validate on the device.

> ⚠️ **Reliability caveats before you commit a phone to this:**
> - **Android 15 is the riskiest OS** for this — it kills long-running Termux processes even
>   with wake-lock + battery-unrestricted (termux-app#5150). Prefer an **Android 12–14** device.
> - A phone charging at 100 % 24/7 will swell its battery in 6–18 months. Use a smart-plug
>   charge schedule or a sacrificial device.
> - A single phone is a single point of failure. The external uptime check (§6) is mandatory,
>   and the cloud read-replica (ARCHITECTURE.md §6) is recommended before real traffic.

## Gate 2 — DNS (do first)
The named tunnel can only bind `api.voltai.uz` if the **voltai.uz zone is on Cloudflare**.
Today it's on ahost.uz. Move the nameservers to Cloudflare (keep the website's Vercel records).
Full steps: [`docs/GATES.md`](docs/GATES.md) §Gate 2.

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
(Faster: build `dist/` on a dev box and `rsync` it over, then bootstrap runs `npm ci --omit=dev`.)

## 3. Configure env
```bash
cp ~/VoltAI/apps/api/.env.example ~/VoltAI/apps/api/.env
# set at least:
#   INGEST_TOKEN=<random secret>
#   SQLITE_PATH=/data/data/com.termux/files/home/voltai/data/voltai.sqlite
#   CORS_ORIGINS=https://voltai.uz,https://www.voltai.uz
```
Seed the DB from the last Atlas export (or let /ingest + merge fill it): see ARCHITECTURE.md §5.3.

## 4. Cloudflare tunnel
```bash
cloudflared tunnel login                 # pick the voltai.uz zone
cloudflared tunnel create voltai-api     # writes ~/.cloudflared/<UUID>.json
cp ~/VoltAI/apps/api/scripts/cloudflared/config.example.yml ~/.cloudflared/config.yml
#   edit ~/.cloudflared/config.yml → fill <TUNNEL-UUID>
cloudflared tunnel route dns voltai-api api.voltai.uz   # replaces the Vercel CNAME
```
Then add a Cloudflare **Cache Rule** on `api.voltai.uz/api/stations*` (edge TTL 300s,
stale-if-error 7d) — mandatory, the single phone CPU is otherwise the whole capacity plane.

## 5. Run under supervision + autostart
```bash
bash ~/VoltAI/apps/api/scripts/termux/install-services.sh   # runit services: voltai-api + cloudflared
ln -s ~/VoltAI/apps/api/scripts/termux/boot.sh ~/.termux/boot/00-voltai && chmod +x ~/.termux/boot/00-voltai
# launch the Termux:Boot app once so its boot receiver registers
```
Control: `sv up|down|restart voltai-api cloudflared`. Logs: `~/voltai/logs/{api,cloudflared}/current`.

## 6. Monitoring & backup
- **External** uptime check on `https://api.voltai.uz/api/health` (UptimeRobot/BetterStack) →
  Telegram. This is the only thing that catches Android killing the whole process.
- Data freshness: `GET /api/health/detail` exposes `lastIngestAt` per source + `lastMergeAt`.
- Watchdog: `while true; do bash ~/VoltAI/apps/api/scripts/termux/watchdog.sh; sleep 120; done`.
- Backup: nightly `sqlite3 VACUUM INTO` → gzip → `rclone` to Cloudflare R2 (14-day retention).

## Rollback
DNS-level: repoint the `api.voltai.uz` record. Keep the previous origin warm until the phone
has a few days of clean uptime + tested backups.
