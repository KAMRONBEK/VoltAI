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

# ---- 2+3+4. ship the bundle and apply it with the SAME code path CI-driven updates use ----------
# (apps/api/scripts/termux/apply-update.sh: snapshot → copy → npm ci if lock changed → git checkout
#  → restart → smoke → rollback on failure). Restart is deferred until after --setup below.
BUNDLE="$(mktemp -t voltai-bundle-XXXXXX).tar.gz"
tar -C "$ROOT" -czf "$BUNDLE" \
  package.json package-lock.json \
  apps/api/package.json apps/api/dist apps/api/scripts apps/api/docs apps/api/.env.example \
  apps/api/apps.json apps/api/RUNBOOK.md
log "shipping bundle ($(du -h "$BUNDLE" | cut -f1))"
"${SSH[@]}" "mkdir -p /data/data/com.termux/files/home/voltai/state/incoming && cat > /data/data/com.termux/files/home/voltai/state/incoming/manual-$SHORT.tar.gz" < "$BUNDLE"
rm -f "$BUNDLE"
# Fresh phone: the apply script itself comes from the bundle — unpack just the scripts first.
"${SSH[@]}" "mkdir -p '$PHONE_REPO' && tar -xzf /data/data/com.termux/files/home/voltai/state/incoming/manual-$SHORT.tar.gz -C '$PHONE_REPO' apps/api/scripts && sed -i 's/\r\$//' '$PHONE_REPO'/apps/api/scripts/termux/*.sh '$PHONE_REPO'/apps/api/scripts/*.sh && chmod +x '$PHONE_REPO'/apps/api/scripts/termux/*.sh '$PHONE_REPO'/apps/api/scripts/*.sh"
if [ -n "$DIRTY" ]; then
  log "note: this is an UNCOMMITTED build — the phone's auto-updater pauses until a committed build is deployed"
fi

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

# ---- 6. supervise (first run / --setup), then apply (restart + smoke, rollback on failure) ------
if [ "$DO_SETUP" = 1 ] || ! "${SSH[@]}" "$SVENV sv status voltai-api >/dev/null 2>&1"; then
  log "phone: install-services.sh + install-boot.sh"
  # The bundle's scripts must be in place before install-services runs → apply without restart first.
  "${SSH[@]}" "bash '$PHONE_REPO/apps/api/scripts/termux/apply-update.sh' /data/data/com.termux/files/home/voltai/state/incoming/manual-$SHORT.tar.gz --no-restart" 2>/dev/null || true
  "${SSH[@]}" "bash '$PHONE_REPO/apps/api/scripts/termux/install-services.sh' && bash '$PHONE_REPO/apps/api/scripts/termux/install-boot.sh' >/dev/null"
fi
log "phone: apply-update.sh (restart + smoke; rolls back on failure)"
"${SSH[@]}" "$SVENV bash '$PHONE_REPO/apps/api/scripts/termux/apply-update.sh' /data/data/com.termux/files/home/voltai/state/incoming/manual-$SHORT.tar.gz"
log "done"
