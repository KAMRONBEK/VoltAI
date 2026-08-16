#!/usr/bin/env bash
# End-to-end smoke test against a running API (phone, dev box or the public URL).
#
#   bash apps/api/scripts/smoke.sh                       # http://127.0.0.1:8080
#   bash apps/api/scripts/smoke.sh https://api.voltai.uz
#   bash apps/api/scripts/smoke.sh http://127.0.0.1:8080 --wait 300   # wait up to 300 s for readiness
#
# Exit 0 only when: liveness answers, readiness is 200 (stations > 0, real DB file, scheduler
# fresh), the catalog + status feed + client-config + plan endpoints answer with the expected
# shapes, and a conditional GET yields a 304.
set -uo pipefail
BASE="${1:-http://127.0.0.1:8080}"; shift || true
WAIT=0
while [ $# -gt 0 ]; do case "$1" in --wait) WAIT="$2"; shift 2 ;; *) shift ;; esac; done

fail=0
say()  { printf '  %-40s %s\n' "$1" "$2"; }
ok()   { say "$1" "OK  $2"; }
bad()  { say "$1" "FAIL $2"; fail=1; }
get()  { local c; c="$(curl -sS -m 25 -o "$TMP/body" -w '%{http_code}' "$@" 2>/dev/null)" || c=000; echo "$c"; }
TMP="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/smoke.$$")"; mkdir -p "$TMP"; trap 'rm -rf "$TMP"' EXIT

echo "smoke: $BASE"

# liveness (retry a little — the process may be starting)
code=000
for _ in $(seq 1 30); do code="$(get "$BASE/api/health")"; [ "$code" = 200 ] && break; sleep 1; done
[ "$code" = 200 ] && ok "/api/health" "$(tr -d '\n' < "$TMP/body" | head -c 80)" || bad "/api/health" "HTTP $code"

# readiness — optionally wait for the first scrape/merge after a fresh start
deadline=$(( $(date +%s) + WAIT ))
while :; do
  code="$(get "$BASE/api/health/ready")"
  [ "$code" = 200 ] && break
  [ "$(date +%s)" -ge "$deadline" ] && break
  sleep 10
done
if [ "$code" = 200 ]; then ok "/api/health/ready" "$(tr -d '\n' < "$TMP/body" | head -c 120)"; else bad "/api/health/ready" "HTTP $code $(tr -d '\n' < "$TMP/body" | head -c 200)"; fi

code="$(get "$BASE/api/health/detail")"
if [ "$code" = 200 ]; then
  ok "/api/health/detail" "$(sed -n 's/.*"commit":"\([^"]*\)".*/commit=\1/p' "$TMP/body" | head -1) $(sed -n 's/.*"stations":\([0-9]*\).*/stations=\1/p' "$TMP/body" | head -1) $(sed -n 's/.*"dbPath":"\([^"]*\)".*/db=\1/p' "$TMP/body" | head -1)"
else bad "/api/health/detail" "HTTP $code"; fi

code="$(get "$BASE/api/stations?limit=2")"
if [ "$code" = 200 ] && grep -q '"items":\[{' "$TMP/body"; then ok "/api/stations?limit=2" "total=$(sed -n 's/.*"total":\([0-9]*\).*/\1/p' "$TMP/body" | head -1)"; else bad "/api/stations?limit=2" "HTTP $code"; fi

code="$(get "$BASE/api/stations?page=abc")"
[ "$code" = 400 ] && ok "/api/stations?page=abc → 400" "" || bad "/api/stations?page=abc" "HTTP $code (want 400)"

code="$(get "$BASE/api/stations?q=%D0%A2%D0%B0%D1%88%D0%BA%D0%B5%D0%BD%D1%82")"
[ "$code" = 200 ] && ok "/api/stations?q=Ташкент (unicode ETag)" "" || bad "/api/stations?q=Ташкент" "HTTP $code"

code="$(get -D "$TMP/hdr" "$BASE/api/stations/statuses")"
etag="$(sed -n 's/^[Ee][Tt]ag: *//p' "$TMP/hdr" | tr -d '\r\n')"
if [ "$code" = 200 ] && grep -q '"stations":\[' "$TMP/body"; then ok "/api/stations/statuses" "count=$(sed -n 's/.*"count":\([0-9]*\).*/\1/p' "$TMP/body" | head -1) stale=$(sed -n 's/.*"stale":\(true\|false\).*/\1/p' "$TMP/body" | head -1)"; else bad "/api/stations/statuses" "HTTP $code"; fi
if [ -n "$etag" ]; then
  code="$(get -H "If-None-Match: $etag" "$BASE/api/stations/statuses")"
  if [ "$code" != 304 ]; then
    # A merge may have landed between the two requests (e.g. the startup scrape right after a
    # restart) — that legitimately changes the ETag. Re-read it once and retry.
    sleep 3
    get -D "$TMP/hdr" "$BASE/api/stations/statuses" >/dev/null
    etag="$(sed -n 's/^[Ee][Tt]ag: *//p' "$TMP/hdr" | tr -d '\r\n')"
    code="$(get -H "If-None-Match: $etag" "$BASE/api/stations/statuses")"
  fi
  [ "$code" = 304 ] && ok "statuses If-None-Match → 304" "" || bad "statuses If-None-Match" "HTTP $code (want 304)"
fi

code="$(get "$BASE/api/client-config")"
[ "$code" = 200 ] && grep -q '"minAppVersion"' "$TMP/body" && ok "/api/client-config" "$(tr -d '\n' < "$TMP/body" | head -c 100)" || bad "/api/client-config" "HTTP $code"

# Tashkent → Samarkand, GB/T DC, 400 km range, 80% SoC, arrive with ≥ 20% (the knob the app sends;
# `reserve=` in the OK line is empty on a backend that predates it, which is worth seeing)
code="$(get "$BASE/api/plan?from=41.311,69.279&to=39.654,66.975&range=400&soc=80&plug=GBT_DC&reservePct=20")"
if [ "$code" = 200 ]; then ok "/api/plan Tashkent→Samarkand" "geometry=$(sed -n 's/.*"geometry":"\([a-z]*\)".*/\1/p' "$TMP/body" | head -1) feasible=$(sed -n 's/.*"feasible":\(true\|false\).*/\1/p' "$TMP/body" | head -1) reserve=$(sed -n 's/.*"destinationPct":\([0-9.]*\).*/\1%/p' "$TMP/body" | head -1)"; else bad "/api/plan" "HTTP $code $(head -c 200 "$TMP/body")"; fi

code="$(get -X POST -H 'content-type: application/json' --data '{}' "$BASE/ingest")"
case "$code" in 401|404) ok "/ingest without token → $code" "" ;; *) bad "/ingest without token" "HTTP $code (want 401/404)" ;; esac

if [ "$fail" = 0 ]; then echo "smoke: ALL OK"; else echo "smoke: FAILURES"; fi
exit "$fail"
