#!/data/data/com.termux/files/usr/bin/bash
# On-device watchdog — runs every 2 min as the `voltai-watchdog` runit service.
#
#   1. Re-asserts the Termux wake lock (cheap, idempotent) so CPU/Wi-Fi stay awake even if the
#      boot script was never the thing that started us (e.g. services started from an ssh session).
#   2. Liveness: /api/health with a generous timeout (the API is single-threaded and a merge can
#      block the event loop for a few seconds on a phone CPU). Only after 3 CONSECUTIVE misses
#      (~6 min) is voltai-api restarted — a hair-trigger restart used to land mid-transaction.
#   3. Readiness: /api/health/ready is logged (503 = empty catalog / temp DB / stale scheduler); a
#      restart cannot fix those, so it only warns — the external monitor is what pages a human.
#   4. Edge: only when the tunnel is configured, cloudflared has been up > 5 min, and the uplink
#      itself works, restart cloudflared if the public URL fails 3 times in a row — at most once
#      per 15 min. Never restarts the tunnel because the internet is down.
#
# NOTE: this only covers on-device failures. If Android kills the whole Termux process, nothing
# on the phone can restart it — pair with an EXTERNAL uptime check on /api/health/ready.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

PORT="$(api_port)"
PUBLIC_URL="$(env_get PUBLIC_HEALTH_URL "https://api.voltai.uz/api/health")"
STATE_DIR="$HOME/voltai/state"
mkdir -p "$STATE_DIR"
API_FAILS="$STATE_DIR/api-fails"
EDGE_FAILS="$STATE_DIR/edge-fails"
EDGE_LAST_RESTART="$STATE_DIR/edge-last-restart"

count() { cat "$1" 2>/dev/null || echo 0; }
bump()  { echo $(( $(count "$1") + 1 )) > "$1"; }
reset() { echo 0 > "$1"; }

have termux-wake-lock && termux-wake-lock >/dev/null 2>&1 || true

# --- 1/2. local liveness + readiness -----------------------------------------------------------
if curl -fsS -m 20 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  reset "$API_FAILS"
  ready="$(curl -sS -m 20 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health/ready" 2>/dev/null)" || ready=000
  if [ "$ready" = "200" ]; then
    log "ok: api alive, ready (api uptime $(sv status voltai-api 2>/dev/null | sed -n 's/^run: voltai-api: (pid [0-9]*) \([0-9]*\)s.*/\1/p')s)"
  else
    warn "API alive but not ready (HTTP $ready): $(curl -sS -m 10 "http://127.0.0.1:$PORT/api/health/ready" 2>/dev/null | head -c 300)"
  fi
else
  bump "$API_FAILS"
  n="$(count "$API_FAILS")"
  warn "API not answering on :$PORT (miss $n/3)"
  if [ "$n" -ge 3 ]; then
    if sv status voltai-api 2>/dev/null | grep -q '^run:'; then
      warn "restarting voltai-api (force: a wedged event loop ignores TERM)"
      sv force-restart voltai-api >/dev/null 2>&1 || true
    else
      warn "voltai-api is not running under runit — bringing it up"
      sv up voltai-api >/dev/null 2>&1 || true
    fi
    reset "$API_FAILS"
  fi
  exit 0
fi

# --- 4. edge (only meaningful once the tunnel exists) -----------------------------------------
if [ -s "$HOME/.cloudflared/token" ] || [ -s "$HOME/.cloudflared/config.yml" ]; then
  # cloudflared uptime in seconds, from `sv status` ("run: cloudflared: (pid 123) 456s; ...")
  up="$(sv status cloudflared 2>/dev/null | sed -n 's/^run: cloudflared: (pid [0-9]*) \([0-9]*\)s.*/\1/p')"
  if [ -n "$up" ] && [ "$up" -gt 300 ]; then
    if ! curl -fsS -m 8 https://1.1.1.1/cdn-cgi/trace >/dev/null 2>&1; then
      log "uplink down — not judging the tunnel"
      exit 0
    fi
    if curl -fsS -m 15 "$PUBLIC_URL" >/dev/null 2>&1; then
      reset "$EDGE_FAILS"
    else
      bump "$EDGE_FAILS"
      n="$(count "$EDGE_FAILS")"
      warn "edge $PUBLIC_URL failing (miss $n/3) while the API is fine locally"
      last="$(count "$EDGE_LAST_RESTART")"
      now="$(date +%s)"
      if [ "$n" -ge 3 ] && [ $((now - last)) -gt 900 ]; then
        warn "restarting cloudflared"
        sv restart cloudflared >/dev/null 2>&1 || true
        echo "$now" > "$EDGE_LAST_RESTART"
        reset "$EDGE_FAILS"
      fi
    fi
  fi
fi
exit 0
