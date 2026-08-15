#!/usr/bin/env bash
# Deploy the API to the phone from the dev box (Git Bash / macOS / Linux). Repeatable; ~1-3 min.
#
#   bash apps/api/scripts/phone/deploy.sh                 build → ship → npm ci (if lock changed) → restart → smoke
#   bash apps/api/scripts/phone/deploy.sh --data          also copy data/auth-tokens.json + tokbor-details.json
#                                                         (only files the phone does not have; --force-data overwrites)
#   bash apps/api/scripts/phone/deploy.sh --setup         also (re)run install-services.sh + install-boot.sh
#   bash apps/api/scripts/phone/deploy.sh --no-build      ship the existing dist/
#
# Connection: ssh to Termux's sshd. Over USB: `adb forward tcp:8022 tcp:8022` (done automatically
# when adb is on PATH), then PHONE_SSH=u0_a232@127.0.0.1. Over Wi-Fi: PHONE_SSH=u0_a232@<phone-ip>.
# Key: PHONE_KEY (default ~/.ssh/voltai_phone) — its .pub must be in the phone's authorized_keys.
#
# What gets shipped (tar over ssh, no rsync needed): apps/api/dist (built here — tsc never runs on
# the phone), apps/api/{package.json,scripts,docs,.env.example,apps.json,RUNBOOK.md}, and the
# root package.json + package-lock.json so the phone can `npm ci -w voltai-api --omit=dev` against
# the SAME lockfile the dev box tested. If the deployed commit exists on origin, the phone checkout
# is first moved to it (git checkout -f), so scripts/docs match; otherwise the overlay still works
# but `git status` on the phone shows the difference.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
API="$ROOT/apps/api"

PHONE_SSH="${PHONE_SSH:-u0_a232@127.0.0.1}"
PHONE_PORT="${PHONE_PORT:-8022}"
PHONE_KEY="${PHONE_KEY:-$HOME/.ssh/voltai_phone}"
PHONE_REPO="${PHONE_REPO:-/data/data/com.termux/files/home/VoltAI}"
PHONE_DATA="${PHONE_DATA:-/data/data/com.termux/files/home/voltai/data}"

DO_BUILD=1; DO_DATA=0; FORCE_DATA=0; DO_SETUP=0
for a in "$@"; do
  case "$a" in
    --no-build) DO_BUILD=0 ;;
    --data) DO_DATA=1 ;;
    --force-data) DO_DATA=1; FORCE_DATA=1 ;;
    --setup) DO_SETUP=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -p "$PHONE_PORT" -i "$PHONE_KEY" "$PHONE_SSH")
# Non-login ssh commands do not get termux-services' SVDIR from profile.d — set it explicitly.
SVENV='export SVDIR=/data/data/com.termux/files/usr/var/service LOGDIR=/data/data/com.termux/files/usr/var/log;'

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }

if command -v adb >/dev/null 2>&1 && [[ "$PHONE_SSH" == *@127.0.0.1 ]]; then
  adb forward "tcp:$PHONE_PORT" tcp:8022 >/dev/null 2>&1 || true
fi
"${SSH[@]}" 'echo ok' >/dev/null || { echo "cannot ssh to $PHONE_SSH:$PHONE_PORT (is sshd running in Termux? adb forward?)" >&2; exit 1; }

# ---- 1. build ------------------------------------------------------------------------------
if [ "$DO_BUILD" = 1 ]; then
  log "building apps/api (tsc + version stamp)"
  (cd "$ROOT" && npm run build -w voltai-api >/dev/null)
fi
[ -f "$API/dist/src/index.js" ] || { echo "no dist/src/index.js — build failed?" >&2; exit 1; }
COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
SHORT="$(git -C "$ROOT" rev-parse --short HEAD)"
DIRTY="$(git -C "$ROOT" status --porcelain -- apps/api package.json package-lock.json | head -c1)"
log "commit $SHORT${DIRTY:+ (+uncommitted changes)}"

# ---- 2. move the phone checkout to this commit when origin has it ---------------------------
ON_ORIGIN=0
if git -C "$ROOT" branch -r --contains "$COMMIT" 2>/dev/null | grep -q .; then ON_ORIGIN=1; fi
if [ "$ON_ORIGIN" = 1 ]; then
  log "phone: git fetch + checkout $SHORT"
  "${SSH[@]}" "cd '$PHONE_REPO' && git fetch -q origin && git checkout -q -f '$COMMIT' 2>&1 | tail -1 || true"
else
  log "commit not on origin — overlaying files on the phone checkout (git status there will be dirty)"
fi

# ---- 3. ship files -------------------------------------------------------------------------
log "shipping dist + scripts + lockfile"
tar -C "$ROOT" -czf - \
  package.json package-lock.json \
  apps/api/package.json apps/api/dist apps/api/scripts apps/api/docs apps/api/.env.example \
  apps/api/apps.json apps/api/RUNBOOK.md \
  | "${SSH[@]}" "mkdir -p '$PHONE_REPO' && rm -rf '$PHONE_REPO/apps/api/dist' && tar -xzf - -C '$PHONE_REPO' && sed -i 's/\r\$//' '$PHONE_REPO'/apps/api/scripts/termux/*.sh '$PHONE_REPO'/apps/api/scripts/*.sh && chmod +x '$PHONE_REPO'/apps/api/scripts/termux/*.sh '$PHONE_REPO'/apps/api/scripts/*.sh"

# ---- 4. dependencies (only when the lockfile changed) ---------------------------------------
log "phone: npm ci -w voltai-api --omit=dev (skipped if lockfile unchanged)"
"${SSH[@]}" bash -s <<'EOF'
set -eo pipefail
cd "$HOME/VoltAI"
mkdir -p "$HOME/voltai/state"
want="$(sha256sum package-lock.json | cut -c1-64)"
have="$(cat "$HOME/voltai/state/lock.sha256" 2>/dev/null || true)"
if [ "$want" != "$have" ] || [ ! -d node_modules/express ]; then
  export PUPPETEER_SKIP_DOWNLOAD=1
  # Failure must be loud AND must not record the lockfile as installed (or every later deploy
  # would skip the install and the API would crash-loop on a missing module).
  if ! npm ci -w voltai-api --omit=dev --ignore-scripts --no-audit --no-fund > "$HOME/voltai/state/npm-ci.log" 2>&1; then
    tail -30 "$HOME/voltai/state/npm-ci.log"; echo "npm ci failed on the phone" >&2; exit 1
  fi
  tail -2 "$HOME/voltai/state/npm-ci.log"
  echo "$want" > "$HOME/voltai/state/lock.sha256"
  # A stale per-workspace node_modules from the old bootstrap would shadow the fresh hoisted tree.
  rm -rf apps/api/node_modules apps/api/package-lock.json
fi
node -e 'require("/data/data/com.termux/files/home/VoltAI/node_modules/express/package.json"); console.log("deps ok")'
EOF

# ---- 5. data files -------------------------------------------------------------------------
if [ "$DO_DATA" = 1 ]; then
  for f in auth-tokens.json tokbor-details.json; do
    if [ -f "$API/data/$f" ]; then
      if [ "$FORCE_DATA" = 1 ] || ! "${SSH[@]}" "test -s '$PHONE_DATA/$f'"; then
        log "copying data/$f"
        "${SSH[@]}" "mkdir -p '$PHONE_DATA' && cat > '$PHONE_DATA/$f.tmp' && mv -f '$PHONE_DATA/$f.tmp' '$PHONE_DATA/$f' && chmod 600 '$PHONE_DATA/$f'" < "$API/data/$f"
      else
        log "phone already has $f (use --force-data to overwrite)"
      fi
    fi
  done
fi

# ---- 6. supervise / restart ----------------------------------------------------------------
if [ "$DO_SETUP" = 1 ] || ! "${SSH[@]}" "$SVENV sv status voltai-api >/dev/null 2>&1"; then
  log "phone: install-services.sh + install-boot.sh"
  "${SSH[@]}" "bash '$PHONE_REPO/apps/api/scripts/termux/install-services.sh' && bash '$PHONE_REPO/apps/api/scripts/termux/install-boot.sh' >/dev/null"
fi
# Always restart so the freshly shipped dist/ is what runs (install-services alone leaves a
# running API on the old code). -w 30: a shutdown mid-merge can take longer than sv's 7 s default.
log "phone: sv restart voltai-api"
"${SSH[@]}" "$SVENV sv -w 30 restart voltai-api"

# ---- 7. smoke ------------------------------------------------------------------------------
log "smoke test"
"${SSH[@]}" "bash '$PHONE_REPO/apps/api/scripts/smoke.sh' http://127.0.0.1:\$(grep -E '^PORT=' '$PHONE_REPO/apps/api/.env' | tail -1 | cut -d= -f2 | tr -d '\r' || echo 8080) --wait 300"
log "done"
