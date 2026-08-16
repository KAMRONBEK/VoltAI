#!/data/data/com.termux/files/usr/bin/bash
# Apply a built API bundle to this phone — the ONE code path for every deploy, whether the bundle
# came from the dev box (scripts/phone/deploy.sh) or from CI via the updater (updater.sh).
#
#   bash apply-update.sh <bundle.tar.gz> [--no-restart]
#
# The bundle is a tar of repo-root-relative paths: package.json, package-lock.json,
# apps/api/{package.json,dist,scripts,docs,.env.example,apps.json,RUNBOOK.md} (what deploy.sh and
# the CI publish step both produce). Steps:
#   1. take the update lock (only one apply at a time — updater vs manual deploy)
#   2. unpack to a staging dir, sanity-check it (dist/src/index.js + dist/version.json)
#   3. snapshot the currently installed dist + package files for rollback
#   4. copy the bundle over the checkout; LF-fix + chmod the shipped scripts
#   5. `npm ci -w voltai-api --omit=dev --ignore-scripts` when the root lockfile changed
#   6. move the git checkout to the bundle's commit when it exists on origin (docs/scripts in step)
#   7. `sv -w 30 restart voltai-api`, then scripts/smoke.sh --wait 240
#   8. on ANY failure after step 4: restore the snapshot, npm ci back if needed, restart, exit 1
# Exit 0 = the new build is running and passed smoke. State: ~/voltai/state/last-update.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

BUNDLE="${1:-}"; RESTART=1
[ "${2:-}" = "--no-restart" ] && RESTART=0
[ -n "$BUNDLE" ] && [ -f "$BUNDLE" ] || die "usage: apply-update.sh <bundle.tar.gz>"

STATE="$HOME/voltai/state"; mkdir -p "$STATE"
LOCK="$STATE/update.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # A stale lock from a killed run must not block updates forever (locks older than 30 min).
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null; mkdir "$LOCK" 2>/dev/null || die "update already in progress"; else die "update already in progress ($LOCK)"; fi
fi
STAGE="$STATE/stage-$$"
PREV="$STATE/prev"
cleanup() { rm -rf "$STAGE"; rmdir "$LOCK" 2>/dev/null || true; }
trap cleanup EXIT

record() { printf 'at=%s result=%s commit=%s note=%s\n' "$(date -Is)" "$1" "$2" "${3:-}" > "$STATE/last-update"; }

# ---- 2. unpack + sanity ---------------------------------------------------------------------
mkdir -p "$STAGE"
tar -xzf "$BUNDLE" -C "$STAGE" || { record failed unknown "bad tarball"; die "cannot unpack $BUNDLE"; }
[ -f "$STAGE/apps/api/dist/src/index.js" ] || { record failed unknown "no dist"; die "bundle has no apps/api/dist/src/index.js"; }
[ -f "$STAGE/package-lock.json" ] || { record failed unknown "no lock"; die "bundle has no root package-lock.json"; }
NEW_COMMIT="$(node -p "try{require('$STAGE/apps/api/dist/version.json').commit}catch(e){'unknown'}")"
NEW_DIRTY="$(node -p "try{String(!!require('$STAGE/apps/api/dist/version.json').dirty)}catch(e){'false'}")"
CUR_COMMIT="$(node -p "try{require('$API_DIR/dist/version.json').commit}catch(e){'none'}" 2>/dev/null || echo none)"
log "applying $NEW_COMMIT${NEW_DIRTY:+ (dirty=$NEW_DIRTY)} over $CUR_COMMIT"

# ---- 3. snapshot for rollback ---------------------------------------------------------------
rm -rf "$PREV"; mkdir -p "$PREV/apps/api"
[ -d "$API_DIR/dist" ] && cp -a "$API_DIR/dist" "$PREV/apps/api/dist"
cp -a "$API_DIR/package.json" "$PREV/apps/api/package.json" 2>/dev/null || true
cp -a "$REPO/package.json" "$PREV/package.json" 2>/dev/null || true
cp -a "$REPO/package-lock.json" "$PREV/package-lock.json" 2>/dev/null || true
OLD_LOCK_HASH="$(sha256sum "$REPO/package-lock.json" 2>/dev/null | cut -c1-64 || true)"

rollback() {  # rollback <why>
  warn "ROLLING BACK: $1"
  rm -rf "$API_DIR/dist"
  [ -d "$PREV/apps/api/dist" ] && cp -a "$PREV/apps/api/dist" "$API_DIR/dist"
  [ -f "$PREV/apps/api/package.json" ] && cp -a "$PREV/apps/api/package.json" "$API_DIR/package.json"
  [ -f "$PREV/package.json" ] && cp -a "$PREV/package.json" "$REPO/package.json"
  [ -f "$PREV/package-lock.json" ] && cp -a "$PREV/package-lock.json" "$REPO/package-lock.json"
  local h; h="$(sha256sum "$REPO/package-lock.json" 2>/dev/null | cut -c1-64 || true)"
  if [ "$h" != "$(cat "$STATE/lock.sha256" 2>/dev/null)" ]; then
    (cd "$REPO" && PUPPETEER_SKIP_DOWNLOAD=1 npm ci -w voltai-api --omit=dev --ignore-scripts --no-audit --no-fund >"$STATE/npm-ci-rollback.log" 2>&1) && echo "$h" > "$STATE/lock.sha256" || warn "npm ci during rollback failed — see $STATE/npm-ci-rollback.log"
  fi
  [ "$RESTART" = 1 ] && sv -w 30 restart voltai-api >/dev/null 2>&1 || true
  record rolled-back "$NEW_COMMIT" "$1"
  exit 1
}

# ---- 4. apply files ------------------------------------------------------------------------
rm -rf "$API_DIR/dist"
( cd "$STAGE" && tar -cf - . ) | tar -xf - -C "$REPO" || rollback "copy failed"
sed -i 's/\r$//' "$API_DIR"/scripts/termux/*.sh "$API_DIR"/scripts/*.sh "$API_DIR"/scripts/phone/*.sh 2>/dev/null || true
chmod +x "$API_DIR"/scripts/termux/*.sh "$API_DIR"/scripts/*.sh "$API_DIR"/scripts/phone/*.sh 2>/dev/null || true

# ---- 5. dependencies (only when the lockfile changed) ---------------------------------------
NEW_LOCK_HASH="$(sha256sum "$REPO/package-lock.json" | cut -c1-64)"
if [ "$NEW_LOCK_HASH" != "$(cat "$STATE/lock.sha256" 2>/dev/null)" ] || [ ! -d "$REPO/node_modules/express" ]; then
  log "lockfile changed — npm ci -w voltai-api --omit=dev"
  if (cd "$REPO" && PUPPETEER_SKIP_DOWNLOAD=1 npm ci -w voltai-api --omit=dev --ignore-scripts --no-audit --no-fund >"$STATE/npm-ci.log" 2>&1); then
    echo "$NEW_LOCK_HASH" > "$STATE/lock.sha256"
    rm -rf "$API_DIR/node_modules" "$API_DIR/package-lock.json"
  else
    tail -20 "$STATE/npm-ci.log" >&2
    rollback "npm ci failed"
  fi
fi
node -e "require('$REPO/node_modules/express/package.json')" 2>/dev/null || rollback "express not resolvable after install"

# ---- 6. move the git checkout to the same commit (docs/scripts consistency; best effort) ------
if [ "$NEW_DIRTY" != "true" ] && [ "$NEW_COMMIT" != "unknown" ] && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  ( git -C "$REPO" fetch -q origin 2>/dev/null && git -C "$REPO" checkout -q -f "$NEW_COMMIT" 2>/dev/null ) \
    && log "git checkout $NEW_COMMIT" || warn "commit $NEW_COMMIT not on origin (yet) — checkout left as is"
  # The bundle wins over whatever the checkout has for the shipped paths.
  ( cd "$STAGE" && tar -cf - . ) | tar -xf - -C "$REPO" 2>/dev/null || true
fi

# ---- 7. restart + smoke --------------------------------------------------------------------
if [ "$RESTART" = 1 ]; then
  if sv status voltai-api >/dev/null 2>&1; then
    sv -w 30 restart voltai-api >/dev/null 2>&1 || warn "sv restart reported a timeout — checking health anyway"
  else
    warn "voltai-api is not a runit service yet — run install-services.sh"; record applied "$NEW_COMMIT" "not supervised"; exit 0
  fi
  if bash "$API_DIR/scripts/smoke.sh" "http://127.0.0.1:$(api_port)" --wait 240; then
    record ok "$NEW_COMMIT"
    log "update to $NEW_COMMIT OK"
  else
    rollback "smoke test failed"
  fi
else
  record applied "$NEW_COMMIT" "no restart requested"
fi
