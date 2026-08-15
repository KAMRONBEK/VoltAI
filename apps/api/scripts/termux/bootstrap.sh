#!/data/data/com.termux/files/usr/bin/bash
# One-time Termux setup for hosting the VoltAI API on the phone. Idempotent — safe to re-run.
#
# Prereqs (by hand, before this):
#   - Termux + Termux:Boot + Termux:API from F-Droid (NOT Google Play — different signing key,
#     the add-ons will not bind to the Play build).
#   - git clone https://github.com/KAMRONBEK/VoltAI ~/VoltAI   (or let deploy.sh do it over ssh)
#
# What it does: installs packages, creates ~/voltai/{data,logs,backups,state}, writes a
# production .env (absolute paths, random INGEST_TOKEN) if none exists, creates the backup
# passphrase, sets up sshd, and prints what is still manual. It does NOT build the API — dist/ is
# built on the dev box and shipped by scripts/phone/deploy.sh (tsc on the phone is slow and the
# workspace's node_modules would be huge); nor does it configure the tunnel (RUNBOOK §4).
set -euo pipefail
. "$(dirname "$0")/lib.sh"

export PUPPETEER_SKIP_DOWNLOAD=1 DEBIAN_FRONTEND=noninteractive

log "installing packages"
# No `yes |` here: under `set -o pipefail` the SIGPIPE'd `yes` would abort the script. apt is told
# to keep existing conffiles instead of prompting.
APT_OPTS=(-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
pkg update "${APT_OPTS[@]}" </dev/null >/dev/null 2>&1 || warn "pkg update failed (offline?) — continuing"
pkg install "${APT_OPTS[@]}" nodejs-lts git termux-services termux-api cloudflared rclone sqlite openssh openssl-tool curl </dev/null >/dev/null 2>&1   || die "pkg install failed — run it by hand to see why"

log "storage access (backup copies land on shared storage; a permission dialog may appear once)"
[ -d "$HOME/storage/shared" ] || termux-setup-storage || true

mkdir -p "$DATA_DIR" "$LOG_DIR" "$BACKUP_DIR" "$HOME/voltai/state" "$DATA_DIR/snapshots"

# ---- .env ---------------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  log "writing $ENV_FILE from .env.example with phone defaults"
  cp "$API_DIR/.env.example" "$ENV_FILE"
  token="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  # Absolute paths (never $HOME/~ — dotenv does not expand them); blank == unset in the code, but
  # be explicit so backup/restore/deploy and the app agree on the same files.
  sed -i \
    -e "s|^# *SQLITE_PATH=.*|SQLITE_PATH=$DATA_DIR/voltai.sqlite|" \
    -e "s|^# *AUTH_TOKENS_PATH=.*|AUTH_TOKENS_PATH=$DATA_DIR/auth-tokens.json|" \
    -e "s|^# *TOKBOR_DETAILS_PATH=.*|TOKBOR_DETAILS_PATH=$DATA_DIR/tokbor-details.json|" \
    -e "s|^INGEST_TOKEN=.*|INGEST_TOKEN=$token|" \
    -e "s|^# *HOST=.*|HOST=127.0.0.1|" \
    -e "s|^PORT=.*|PORT=8080|" \
    -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
    "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  warn "fill in MYTAXI_API_KEY (route planner) and BACKUP_REMOTE (after 'rclone config') in $ENV_FILE"
else
  log ".env exists — leaving it alone"
fi

# ---- backup passphrase ---------------------------------------------------------------------
PASSFILE="$HOME/voltai/backup.passphrase"
if [ ! -s "$PASSFILE" ]; then
  head -c 32 /dev/urandom | base64 | tr -d '\n=/+' | head -c 40 > "$PASSFILE"
  chmod 600 "$PASSFILE"
  echo
  echo "=================================================================================="
  echo " NEW BACKUP PASSPHRASE (store it OFF the phone — archives are unreadable without it):"
  echo "   $(cat "$PASSFILE")"
  echo "=================================================================================="
  echo
fi

# ---- sshd ----------------------------------------------------------------------------------
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys"
if [ ! -s "$HOME/.ssh/authorized_keys" ]; then
  warn "no ssh public key in ~/.ssh/authorized_keys yet — add the dev box's key so deploy.sh can reach the phone"
fi
pgrep -x sshd >/dev/null 2>&1 || sshd || true

echo
log "bootstrap done. Next:"
echo "  1. Copy data files to $DATA_DIR: auth-tokens.json + tokbor-details.json (deploy.sh --data does this)"
echo "  2. Deploy a build:      from the dev box  bash apps/api/scripts/phone/deploy.sh"
echo "  3. Supervise + boot:    bash $API_DIR/scripts/termux/install-services.sh ; bash $API_DIR/scripts/termux/install-boot.sh"
echo "  4. Tunnel:              RUNBOOK §4 (token into ~/.cloudflared/token, then sv-enable cloudflared)"
