#!/data/data/com.termux/files/usr/bin/bash
# Register the phone-side services with runit (termux-services) so they are supervised, restart on
# crash, and come back after a reboot (via ~/.termux/boot/00-voltai → service-daemon start).
#
#   voltai-api        node dist/src/index.js            (API + in-process scrapers + SQLite)
#   voltai-watchdog   scripts/termux/watchdog.sh loop   (liveness/self-heal + wake-lock)
#   voltai-backup     scripts/termux/backup.sh at 03:00 (encrypted archive of DB snapshot + secrets)
#   voltai-updater    scripts/termux/updater.sh every 5 min (pull-based CD from GitHub Releases)
#   cloudflared       the tunnel; enabled only once ~/.cloudflared/token or config.yml exists
#   sshd              remote administration (over `adb forward tcp:8022 tcp:8022` or LAN)
#
# Idempotent — re-run after every deploy that changes these scripts. Run: bash install-services.sh
set -euo pipefail
. "$(dirname "$0")/lib.sh"

[ -f "$API_DIR/dist/src/index.js" ] || die "no build at $API_DIR/dist — run bootstrap.sh / deploy first"
have sv || die "termux-services is not installed (pkg install termux-services)"

mkdir -p "$LOG_DIR"/{api,watchdog,backup,updater,cloudflared} "$DATA_DIR" "$BACKUP_DIR" "$HOME/voltai/state"
mkdir -p "$SVDIR"/{voltai-api,voltai-watchdog,voltai-backup,voltai-updater,cloudflared}/log

# Run files are written to a temp name and mv'd into place: a shell that is currently executing
# the old file (voltai-backup sleeps in it for hours) keeps its inode instead of reading a
# half-rewritten script.
install_run() {  # install_run <path>   (content on stdin)
  cat > "$1.tmp" && chmod +x "$1.tmp" && mv -f "$1.tmp" "$1"
}

# ---------------------------------------------------------------- voltai-api
install_run "$SVDIR/voltai-api/run" <<EOF
#!$PREFIX/bin/sh
exec 2>&1
cd "$API_DIR" || exit 1
# .env is read by the app itself (dotenv, blank == unset) — nothing is shell-sourced here, so a
# value with spaces/'*'/'\$' can never be glob-expanded or executed by this run file.
export HOME="$HOME" PREFIX="$PREFIX" TMPDIR="$PREFIX/tmp"
exec node --max-old-space-size=384 dist/src/index.js
EOF

# ---------------------------------------------------------------- voltai-watchdog
install_run "$SVDIR/voltai-watchdog/run" <<EOF
#!$PREFIX/bin/sh
exec 2>&1
export HOME="$HOME" PREFIX="$PREFIX"
# First check 90 s after (re)start so the API has time to come up; then every 2 minutes.
sleep 90
while :; do
  bash "$API_DIR/scripts/termux/watchdog.sh" || true
  sleep 120
done
EOF

# ---------------------------------------------------------------- voltai-backup
install_run "$SVDIR/voltai-backup/run" <<EOF
#!$PREFIX/bin/sh
exec 2>&1
export HOME="$HOME" PREFIX="$PREFIX"
# Sleep until the next 03:00 local (30 min after the API's 02:30 VACUUM INTO snapshot), back up,
# exit; runit restarts us and we wait for the next night.
now=\$(date +%s)
target=\$(date -d 'today 03:00' +%s 2>/dev/null || echo 0)
[ "\$target" -le "\$now" ] && target=\$(date -d 'tomorrow 03:00' +%s 2>/dev/null || echo \$((now + 86400)))
sleep \$((target - now))
bash "$API_DIR/scripts/termux/backup.sh" || true
# Never spin: if backup.sh returned instantly, still wait out the day.
sleep 60
EOF

# ---------------------------------------------------------------- voltai-updater
install_run "$SVDIR/voltai-updater/run" <<EOF
#!$PREFIX/bin/sh
exec 2>&1
export HOME="$HOME" PREFIX="$PREFIX"
# First poll 2 min after (re)start, then every 5 min: fetch the latest CI release and apply it.
sleep 120
while :; do
  bash "$API_DIR/scripts/termux/updater.sh" || true
  sleep 300
done
EOF

# ---------------------------------------------------------------- cloudflared
# Two supported modes, checked in this order:
#   1. ~/.cloudflared/token      remotely-managed tunnel (Zero Trust dashboard; paste the token)
#   2. ~/.cloudflared/config.yml locally-managed tunnel (cloudflared tunnel login/create/route dns)
# Neither present → sleep and re-check every 5 min instead of crash-looping once a second.
install_run "$SVDIR/cloudflared/run" <<EOF
#!$PREFIX/bin/sh
exec 2>&1
export HOME="$HOME" PREFIX="$PREFIX"
if [ -s "$HOME/.cloudflared/token" ]; then
  exec cloudflared --no-autoupdate --protocol http2 --edge-ip-version 4 tunnel run --token-file "$HOME/.cloudflared/token"
elif [ -s "$HOME/.cloudflared/config.yml" ]; then
  exec cloudflared --no-autoupdate --config "$HOME/.cloudflared/config.yml" tunnel run
else
  echo "cloudflared: not configured (no ~/.cloudflared/token or config.yml) — see RUNBOOK §4; sleeping"
  sleep 300
  exit 0
fi
EOF

# ---------------------------------------------------------------- loggers (svlogd, rotated)
for svc in voltai-api voltai-watchdog voltai-backup voltai-updater cloudflared; do
  case "$svc" in
    voltai-api) d=api ;; voltai-watchdog) d=watchdog ;; voltai-backup) d=backup ;; voltai-updater) d=updater ;; *) d=$svc ;;
  esac
  install_run "$SVDIR/$svc/log/run" <<EOF
#!$PREFIX/bin/sh
mkdir -p "$LOG_DIR/$d"
exec svlogd -tt "$LOG_DIR/$d"
EOF
  # svlogd rotation: keep 10 files of 2 MB per service.
  printf 's2000000\nn10\n' > "$LOG_DIR/$d/config"
done

# ---------------------------------------------------------------- supervise
ensure_runsvdir

# A hand-started API (nohup node …) would make the supervised one EADDRINUSE-loop. Stop it.
if pgrep -f 'node .*dist/src/index.js' >/dev/null 2>&1; then
  if ! sv status voltai-api 2>/dev/null | grep -q '^run:'; then
    warn "stopping a hand-started API process so runit can own port $(api_port)"
    pkill -TERM -f 'node .*dist/src/index.js' || true
    sleep 3
  fi
fi

# Give runsvdir a moment to notice new service dirs (it scans every 5 s), then enable.
for _ in 1 2 3 4 5 6; do
  if sv status voltai-api >/dev/null 2>&1; then break; fi
  sleep 1
done
sv-enable voltai-api      >/dev/null 2>&1 || true
sv-enable voltai-watchdog >/dev/null 2>&1 || true
sv-enable voltai-backup   >/dev/null 2>&1 || true
sv-enable voltai-updater  >/dev/null 2>&1 || true
# A hand-started sshd (bootstrap / first login) holds port 8022 and would make the supervised one
# crash-loop. Stop it first — an established ssh session survives (it is a forked child).
if pgrep -x sshd >/dev/null 2>&1 && ! sv status sshd 2>/dev/null | grep -q '^run:'; then
  warn "stopping the hand-started sshd so runit can supervise it (your session stays up)"
  pkill -x sshd || true
  sleep 1
fi
sv-enable sshd            >/dev/null 2>&1 || true
if [ -s "$HOME/.cloudflared/token" ] || [ -s "$HOME/.cloudflared/config.yml" ]; then
  sv-enable cloudflared   >/dev/null 2>&1 || true
else
  # Stay down until the tunnel is configured; enable later with: sv-enable cloudflared
  touch "$SVDIR/cloudflared/down"
  sv down cloudflared >/dev/null 2>&1 || true
fi

sleep 2
echo
echo "== service state =="
for svc in voltai-api voltai-watchdog voltai-backup voltai-updater cloudflared sshd; do sv_state "$svc"; done
echo
echo "Control:  sv up|down|restart <service>      Logs: $LOG_DIR/{api,watchdog,backup,updater,cloudflared}/current"
echo "Boot:     bash $API_DIR/scripts/termux/install-boot.sh   (once) — then test with a reboot"
