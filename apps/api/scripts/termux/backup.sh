#!/data/data/com.termux/files/usr/bin/bash
# Nightly backup of the phone's irreplaceable state to Cloudflare R2 (or any rclone remote).
#
# What it saves (these three files ARE production — none are in git):
#   - voltai.sqlite         the canonical station catalog (hot-copied via the SQLite backup API)
#   - auth-tokens.json      operator login-replay bearer tokens (Tokbor/Beon/Pro-Tok)
#   - tokbor-details.json   per-station Tokbor name/price cache
#
# It builds one timestamped, gzipped tar with a SHA-256 + row-count manifest, uploads it, then
# prunes local and remote copies older than BACKUP_RETENTION_DAYS.
#
# Requires (installed by bootstrap.sh): sqlite, tar, gzip, rclone, coreutils (sha256sum).
# Configure in apps/api/.env:  BACKUP_REMOTE=r2:voltai-backups   [BACKUP_RETENTION_DAYS=14]
# Restore with:  bash apps/api/scripts/termux/restore.sh
#
# Run by hand:   bash apps/api/scripts/termux/backup.sh
# Run nightly:   installed as the `voltai-backup` runit service by install-services.sh
set -euo pipefail

REPO="${REPO:-$HOME/VoltAI}"
API_DIR="$REPO/apps/api"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/voltai/backups}"

# Load .env so paths + BACKUP_REMOTE match the running API.
set -a; [ -f "$API_DIR/.env" ] && . "$API_DIR/.env"; set +a

# Same defaults as the code (src/db/sqlite.ts and the *_PATH loaders): ./data/<file> under API_DIR.
SQLITE_PATH="${SQLITE_PATH:-$API_DIR/data/voltai.sqlite}"
AUTH_TOKENS_PATH="${AUTH_TOKENS_PATH:-$API_DIR/data/auth-tokens.json}"
TOKBOR_DETAILS_PATH="${TOKBOR_DETAILS_PATH:-$API_DIR/data/tokbor-details.json}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [ -z "${BACKUP_REMOTE:-}" ]; then
  echo "backup: BACKUP_REMOTE is unset in $API_DIR/.env — nothing to upload to. Skipping." >&2
  echo "backup: set e.g. BACKUP_REMOTE=r2:voltai-backups (an rclone remote you have configured)." >&2
  exit 0
fi
if [ ! -f "$SQLITE_PATH" ]; then
  echo "backup: SQLITE_PATH ($SQLITE_PATH) does not exist yet — no DB to back up. Skipping." >&2
  exit 0
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="voltai-$STAMP"
STAGE="$BACKUP_ROOT/$NAME"
mkdir -p "$STAGE"
# Never leave a half-written staging dir behind on error.
trap 'rm -rf "$STAGE"' EXIT

echo "backup: hot-copying SQLite -> $STAGE/voltai.sqlite"
# .backup uses SQLite's online backup API: consistent snapshot of a live, WAL-mode DB without
# stopping the API. VACUUM INTO would also work but locks longer; .backup is the safer hot copy.
sqlite3 "$SQLITE_PATH" ".backup '$STAGE/voltai.sqlite'"

# Integrity gate: a corrupt copy is worse than no copy because it hides the loss.
if ! sqlite3 "$STAGE/voltai.sqlite" 'PRAGMA integrity_check;' | grep -qx 'ok'; then
  echo "backup: FAILED integrity_check on the snapshot — aborting, keeping no bad archive." >&2
  exit 1
fi

STATIONS="$(sqlite3 "$STAGE/voltai.sqlite" 'SELECT COUNT(*) FROM stations;' 2>/dev/null || echo '?')"

# Copy the token/detail JSONs if present (they can legitimately be absent on a fresh phone).
for f in "$AUTH_TOKENS_PATH" "$TOKBOR_DETAILS_PATH"; do
  if [ -f "$f" ]; then cp -p "$f" "$STAGE/"; else echo "backup: note — $f absent, not in this archive." >&2; fi
done

# Manifest: checksums + a row count, so a restore can be verified rather than trusted.
( cd "$STAGE" && sha256sum ./* > MANIFEST.sha256 ) || true
{
  echo "created=$STAMP"
  echo "stations_rows=$STATIONS"
  echo "source_db=$SQLITE_PATH"
  echo "retention_days=$RETENTION_DAYS"
} > "$STAGE/MANIFEST.txt"

ARCHIVE="$BACKUP_ROOT/$NAME.tar.gz"
echo "backup: packing -> $ARCHIVE  (stations=$STATIONS)"
tar -C "$BACKUP_ROOT" -czf "$ARCHIVE" "$NAME"
rm -rf "$STAGE"
trap - EXIT

echo "backup: uploading -> $BACKUP_REMOTE/"
rclone copy "$ARCHIVE" "$BACKUP_REMOTE/" --no-traverse

# Prune old local archives.
find "$BACKUP_ROOT" -maxdepth 1 -name 'voltai-*.tar.gz' -type f -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true
# Prune old remote archives (best-effort; rclone understands its own age filter).
rclone delete "$BACKUP_REMOTE/" --include 'voltai-*.tar.gz' --min-age "${RETENTION_DAYS}d" 2>/dev/null || true

echo "backup: done. local=$ARCHIVE remote=$BACKUP_REMOTE/$NAME.tar.gz"
