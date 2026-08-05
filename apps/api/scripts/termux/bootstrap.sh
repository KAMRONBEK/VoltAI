#!/data/data/com.termux/files/usr/bin/bash
# One-time Termux setup for hosting the VoltAI API on the phone.
#
# Prereqs (do these once, by hand, before running this):
#   - Install Termux + Termux:Boot + Termux:API from F-Droid (NOT Google Play — the Play
#     build is signed differently and the add-ons won't bind to it).
#   - Clone this repo to ~/VoltAI  (git clone <url> ~/VoltAI)
#   - Build dist/ on a dev machine and sync it, OR let this script build it here.
#
# Usage:  bash apps/api/scripts/termux/bootstrap.sh
set -euo pipefail

REPO="${REPO:-$HOME/VoltAI}"
API_DIR="$REPO/apps/api"

echo "==> Installing packages"
pkg update -y && pkg upgrade -y
# nodejs-lts (not nodejs/current — its ABI has broken on arm64 before); cloudflared is the
# Termux-built arm64 binary (the GitHub release is glibc and won't run under bionic).
pkg install -y nodejs-lts git termux-services termux-api cloudflared rclone

echo "==> Storage access (for backups / capture bridge)"
termux-setup-storage || true

echo "==> Installing API production deps + building"
cd "$API_DIR"
# Never run tsc/tsx on the phone in production — build on a dev box and sync dist/. But if
# dist/ is missing, do a one-off build here (may be slow / memory-hungry).
if [ ! -f dist/src/index.js ]; then
  npm ci
  npm run build
else
  npm ci --omit=dev
fi

mkdir -p "$HOME/voltai/data" "$HOME/voltai/backups" "$HOME/voltai/logs"

echo
echo "Next:"
echo "  1. cp apps/api/.env.example apps/api/.env  and fill INGEST_TOKEN, SQLITE_PATH=\$HOME/voltai/data/voltai.sqlite"
echo "  2. Set up the Cloudflare tunnel:   see apps/api/RUNBOOK.md (§Tunnel)"
echo "  3. Enable services:                bash apps/api/scripts/termux/install-services.sh"
echo "  4. Enable boot autostart:          launch the Termux:Boot app once, then it runs ~/.termux/boot/*"
