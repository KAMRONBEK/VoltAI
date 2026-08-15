#!/data/data/com.termux/files/usr/bin/bash
# Restore the phone's state from a backup.sh archive on the rclone remote.
#
# Default: fetch the NEWEST voltai-*.tar.gz from BACKUP_REMOTE, verify its SHA-256 manifest and
# SQLite integrity, then move it into place. Whatever is currently on disk is first copied aside
# to <file>.pre-restore-<stamp> so a bad restore is itself reversible.
#
# Usage:
#   bash apps/api/scripts/termux/restore.sh                  # newest remote archive
#   bash apps/api/scripts/termux/restore.sh voltai-YYYYmmdd-HHMMSS.tar.gz   # a specific one
#
# Stop the API first (sv down voltai-api) so nothing writes the DB mid-restore.
set -euo pipefail

REPO="${REPO:-$HOME/VoltAI}"
API_DIR="$REPO/apps/api"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/voltai/backups}"

set -a; [ -f "$API_DIR/.env" ] && . "$API_DIR/.env"; set +a
SQLITE_PATH="${SQLITE_PATH:-$API_DIR/data/voltai.sqlite}"
AUTH_TOKENS_PATH="${AUTH_TOKENS_PATH:-$API_DIR/data/auth-tokens.json}"
TOKBOR_DETAILS_PATH="${TOKBOR_DETAILS_PATH:-$API_DIR/data/tokbor-details.json}"

if [ -z "${BACKUP_REMOTE:-}" ]; then
  echo "restore: BACKUP_REMOTE is unset in $API_DIR/.env — don't know where to pull from." >&2
  exit 1
fi

ARCHIVE_NAME="${1:-}"
if [ -z "$ARCHIVE_NAME" ]; then
  echo "restore: finding newest archive in $BACKUP_REMOTE ..."
  ARCHIVE_NAME="$(rclone lsf "$BACKUP_REMOTE/" --include 'voltai-*.tar.gz' | sort | tail -n1)"
  [ -n "$ARCHIVE_NAME" ] || { echo "restore: no voltai-*.tar.gz found on the remote." >&2; exit 1; }
fi
echo "restore: using $ARCHIVE_NAME"

WORK="$BACKUP_ROOT/.restore-$$"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

rclone copy "$BACKUP_REMOTE/$ARCHIVE_NAME" "$WORK/" --no-traverse
tar -C "$WORK" -xzf "$WORK/$ARCHIVE_NAME"
DIR="$WORK/${ARCHIVE_NAME%.tar.gz}"
[ -d "$DIR" ] || { echo "restore: archive did not unpack to expected dir $DIR." >&2; exit 1; }

# Verify checksums and DB integrity BEFORE touching live files.
( cd "$DIR" && sha256sum -c MANIFEST.sha256 ) || { echo "restore: checksum mismatch — refusing." >&2; exit 1; }
if ! sqlite3 "$DIR/voltai.sqlite" 'PRAGMA integrity_check;' | grep -qx 'ok'; then
  echo "restore: restored DB fails integrity_check — refusing." >&2; exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
restore_one() {  # <src-in-archive> <dest-live-path>
  local src="$1" dest="$2"
  [ -f "$src" ] || { echo "restore: $src not in archive, leaving $dest as-is."; return; }
  mkdir -p "$(dirname "$dest")"
  [ -f "$dest" ] && cp -p "$dest" "$dest.pre-restore-$STAMP" && echo "restore: saved current -> $dest.pre-restore-$STAMP"
  cp -p "$src" "$dest"
  echo "restore: wrote $dest"
}

restore_one "$DIR/voltai.sqlite"       "$SQLITE_PATH"
restore_one "$DIR/auth-tokens.json"    "$AUTH_TOKENS_PATH"
restore_one "$DIR/tokbor-details.json" "$TOKBOR_DETAILS_PATH"

echo "restore: done from $ARCHIVE_NAME. Start the API:  sv up voltai-api"
