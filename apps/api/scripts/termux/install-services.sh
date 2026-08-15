#!/data/data/com.termux/files/usr/bin/bash
# Register the API and the Cloudflare tunnel as runit services (via termux-services), so
# runsv restarts either one automatically if it crashes. Run once after bootstrap.sh.
set -euo pipefail

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
REPO="${REPO:-$HOME/VoltAI}"
API_DIR="$REPO/apps/api"
SVDIR="$PREFIX/var/service"

mkdir -p "$SVDIR/voltai-api/log" "$SVDIR/cloudflared/log" "$SVDIR/voltai-backup/log"

# --- voltai-api service ---
cat > "$SVDIR/voltai-api/run" <<EOF
#!$PREFIX/bin/sh
exec 2>&1
cd "$API_DIR"
set -a; [ -f .env ] && . ./.env; set +a
exec node --max-old-space-size=384 dist/src/index.js
EOF

cat > "$SVDIR/voltai-api/log/run" <<EOF
#!$PREFIX/bin/sh
mkdir -p "$HOME/voltai/logs/api"
exec svlogd -tt "$HOME/voltai/logs/api"
EOF

# --- cloudflared service ---
cat > "$SVDIR/cloudflared/run" <<EOF
#!$PREFIX/bin/sh
exec 2>&1
exec cloudflared --no-autoupdate tunnel run voltai-api
EOF

cat > "$SVDIR/cloudflared/log/run" <<EOF
#!$PREFIX/bin/sh
mkdir -p "$HOME/voltai/logs/cloudflared"
exec svlogd -tt "$HOME/voltai/logs/cloudflared"
EOF

# --- voltai-backup service (runs backup.sh once a day at ~03:00, then loops) ---
cat > "$SVDIR/voltai-backup/run" <<EOF
#!$PREFIX/bin/sh
exec 2>&1
cd "$API_DIR"
# Sleep until the next 03:00 local, then back up. runit restarts us on exit, so we wait again.
now=\$(date +%s)
target=\$(date -d 'today 03:00' +%s 2>/dev/null || echo 0)
[ "\$target" -le "\$now" ] && target=\$(date -d 'tomorrow 03:00' +%s 2>/dev/null || echo \$((now + 86400)))
sleep \$((target - now))
exec bash scripts/termux/backup.sh
EOF

cat > "$SVDIR/voltai-backup/log/run" <<EOF
#!$PREFIX/bin/sh
mkdir -p "$HOME/voltai/logs/backup"
exec svlogd -tt "$HOME/voltai/logs/backup"
EOF

chmod +x "$SVDIR/voltai-api/run" "$SVDIR/voltai-api/log/run" \
         "$SVDIR/cloudflared/run" "$SVDIR/cloudflared/log/run" \
         "$SVDIR/voltai-backup/run" "$SVDIR/voltai-backup/log/run"

# svlogd rotation: 10 x 2MB per service
printf 's2000000\nn10\n' | tee "$HOME/voltai/logs/api/config" "$HOME/voltai/logs/cloudflared/config" \
                                "$HOME/voltai/logs/backup/config" >/dev/null

sv-enable voltai-api || true
sv-enable cloudflared || true
sv-enable voltai-backup || true

echo "Services installed. Control with: sv up/down/restart voltai-api | cloudflared | voltai-backup"
echo "Run a backup now:  bash apps/api/scripts/termux/backup.sh"
echo "Logs: \$HOME/voltai/logs/{api,cloudflared,backup}/current"
