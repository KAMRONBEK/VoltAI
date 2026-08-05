#!/data/data/com.termux/files/usr/bin/bash
# Local watchdog: restart the API if it stops answering, and the tunnel if the API is
# reachable locally but not through the edge. Run from cron/a loop, e.g.:
#   while true; do bash apps/api/scripts/termux/watchdog.sh; sleep 120; done
# NOTE: this only covers on-device failures. Pair it with an EXTERNAL uptime check
# (UptimeRobot/BetterStack on https://api.voltai.uz/api/health) — if Android kills the whole
# Termux process, nothing on the phone can restart it.
set -uo pipefail

PORT="${PORT:-8080}"
PUBLIC_URL="${PUBLIC_HEALTH_URL:-https://api.voltai.uz/api/health}"

local_ok() { curl -fsS -m 5 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; }
edge_ok()  { curl -fsS -m 10 "$PUBLIC_URL" >/dev/null 2>&1; }

if ! local_ok; then
  echo "[watchdog] API not responding locally — restarting voltai-api"
  sv restart voltai-api 2>/dev/null || true
  exit 0
fi

if ! edge_ok; then
  echo "[watchdog] API up locally but edge is down — restarting cloudflared"
  sv restart cloudflared 2>/dev/null || true
fi
