#!/data/data/com.termux/files/usr/bin/bash
# Register the API and the Cloudflare tunnel as runit services (via termux-services), so
# runsv restarts either one automatically if it crashes. Run once after bootstrap.sh.
set -euo pipefail

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
REPO="${REPO:-$HOME/VoltAI}"
API_DIR="$REPO/apps/api"
SVDIR="$PREFIX/var/service"

mkdir -p "$SVDIR/voltai-api/log" "$SVDIR/cloudflared/log"

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

chmod +x "$SVDIR/voltai-api/run" "$SVDIR/voltai-api/log/run" \
         "$SVDIR/cloudflared/run" "$SVDIR/cloudflared/log/run"

# svlogd rotation: 10 x 2MB per service
printf 's2000000\nn10\n' | tee "$HOME/voltai/logs/api/config" "$HOME/voltai/logs/cloudflared/config" >/dev/null

sv-enable voltai-api || true
sv-enable cloudflared || true

echo "Services installed. Control with: sv up/down/restart voltai-api | cloudflared"
echo "Logs: \$HOME/voltai/logs/{api,cloudflared}/current"
