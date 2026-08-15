#!/data/data/com.termux/files/usr/bin/bash
# Restore the phone's state from a backup.sh archive (voltai-*.tar.gz.enc).
#
#   bash restore.sh                          # newest archive in ~/voltai/backups (falls back to
#                                            # ~/storage/shared/VoltAI-backups, then BACKUP_REMOTE)
#   bash restore.sh /path/to/voltai-….tar.gz.enc
#   bash restore.sh --dry-run [archive]      # decrypt + verify only; touch nothing
#   bash restore.sh --db-only  [archive]     # only the SQLite file (keep current tokens/.env)
#
# The API is STOPPED for the duration (sv down), the stale -journal/.lock/.pid are removed so an
# old hot journal can never be replayed into the restored file, files land via tmp+mv, whatever
# was on disk is kept as <file>.pre-restore-<stamp>, then the API is started and /api/health/ready
# is checked. Needs the passphrase in ~/voltai/backup.passphrase.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

DRY=0; DB_ONLY=0; ARCHIVE=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --db-only) DB_ONLY=1 ;;
    *) ARCHIVE="$a" ;;
  esac
done

SQLITE_PATH="$(sqlite_path)"
AUTH_TOKENS_PATH="$(auth_tokens_path)"
TOKBOR_DETAILS_PATH="$(tokbor_details_path)"
REMOTE="$(env_get BACKUP_REMOTE "")"
PASSFILE="$HOME/voltai/backup.passphrase"
SHARED_DIR="$HOME/storage/shared/VoltAI-backups"
PORT="$(api_port)"

have sqlite3 || die "sqlite3 CLI missing (pkg install sqlite)"
have openssl || die "openssl missing (pkg install openssl-tool)"
[ -s "$PASSFILE" ] || die "no passphrase at $PASSFILE — restore it from your off-phone copy first"

WORK="$BACKUP_DIR/.restore-$$"
mkdir -p "$WORK"; trap 'rm -rf "$WORK"' EXIT

if [ -z "$ARCHIVE" ]; then
  ARCHIVE="$(ls -1 "$BACKUP_DIR"/voltai-*.tar.gz.enc 2>/dev/null | sort | tail -n1 || true)"
  [ -n "$ARCHIVE" ] || ARCHIVE="$(ls -1 "$SHARED_DIR"/voltai-*.tar.gz.enc 2>/dev/null | sort | tail -n1 || true)"
  if [ -z "$ARCHIVE" ] && [ -n "$REMOTE" ] && have rclone; then
    NAME="$(rclone lsf "$REMOTE/" --include 'voltai-*.tar.gz.enc' | sort | tail -n1)"
    [ -n "$NAME" ] || die "no archive found locally, on shared storage or on $REMOTE"
    rclone copy "$REMOTE/$NAME" "$WORK/" --no-traverse
    ARCHIVE="$WORK/$NAME"
  fi
  [ -n "$ARCHIVE" ] || die "no archive found"
fi
[ -f "$ARCHIVE" ] || die "archive not found: $ARCHIVE"
log "using $ARCHIVE"

if [ -f "$ARCHIVE.sha256" ]; then
  ( cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256" ) >/dev/null || die "archive checksum mismatch"
fi

openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$PASSFILE" -in "$ARCHIVE" | tar -C "$WORK" -xzf - || die "decrypt/unpack failed (wrong passphrase?)"
DIR="$(find "$WORK" -maxdepth 1 -mindepth 1 -type d -name 'voltai-*' | head -n1)"
[ -n "$DIR" ] || die "archive did not unpack to a voltai-* dir"
( cd "$DIR" && sha256sum -c MANIFEST.sha256 ) >/dev/null || die "manifest checksum mismatch — refusing"
cat "$DIR/MANIFEST.txt"

if [ -f "$DIR/voltai.sqlite" ]; then
  sqlite3 "$DIR/voltai.sqlite" 'PRAGMA integrity_check;' | grep -qx 'ok' || die "DB in archive fails integrity_check — refusing"
  log "archive DB has $(sqlite3 "$DIR/voltai.sqlite" 'SELECT COUNT(*) FROM stations;') stations"
fi
[ "$DRY" = 1 ] && { log "dry run OK — nothing changed"; exit 0; }

STAMP="$(date +%Y%m%d-%H%M%S)"
API_WAS_UP=0
# Pause the watchdog for the duration (it would `sv up` the API after 3 misses) and make sure the
# API comes back even if something below fails.
WD_WAS_UP=0
if sv status voltai-watchdog 2>/dev/null | grep -q '^run:'; then WD_WAS_UP=1; sv down voltai-watchdog >/dev/null 2>&1 || true; fi
finish() {
  rm -rf "$WORK"
  [ "$API_WAS_UP" = 1 ] && sv up voltai-api >/dev/null 2>&1 || true
  [ "$WD_WAS_UP" = 1 ] && sv up voltai-watchdog >/dev/null 2>&1 || true
}
trap finish EXIT
if sv status voltai-api 2>/dev/null | grep -q '^run:'; then
  API_WAS_UP=1
  log "stopping voltai-api"
  sv down voltai-api
  for _ in $(seq 1 30); do pgrep -f 'node .*dist/src/index.js' >/dev/null || break; sleep 1; done
fi
pgrep -f 'node .*dist/src/index.js' >/dev/null && die "an API process is still running — stop it first"

place() {  # place <src> <dest>
  local src="$1" dest="$2"
  [ -f "$src" ] || { log "$(basename "$src") not in archive — leaving $dest as-is"; return; }
  mkdir -p "$(dirname "$dest")"
  [ -f "$dest" ] && cp -p "$dest" "$dest.pre-restore-$STAMP" && log "kept current -> $dest.pre-restore-$STAMP"
  cp -p "$src" "$dest.tmp" && mv -f "$dest.tmp" "$dest"
  log "restored $dest"
}

if [ -f "$DIR/voltai.sqlite" ]; then
  # A leftover hot journal / lock from the OLD database must never meet the restored file.
  rm -f "$SQLITE_PATH-journal" "$SQLITE_PATH.pid"; rm -rf "$SQLITE_PATH.lock"
  place "$DIR/voltai.sqlite" "$SQLITE_PATH"
fi
if [ "$DB_ONLY" = 0 ]; then
  place "$DIR/auth-tokens.json" "$AUTH_TOKENS_PATH"; chmod 600 "$AUTH_TOKENS_PATH" 2>/dev/null || true
  place "$DIR/tokbor-details.json" "$TOKBOR_DETAILS_PATH"
  if [ -f "$DIR/env" ]; then place "$DIR/env" "$ENV_FILE"; fi
  if [ -d "$DIR/cloudflared" ]; then
    mkdir -p "$HOME/.cloudflared"; cp -p "$DIR"/cloudflared/* "$HOME/.cloudflared/" && log "restored ~/.cloudflared/*"
  fi
  if [ -f "$DIR/rclone.conf" ]; then mkdir -p "$HOME/.config/rclone"; place "$DIR/rclone.conf" "$HOME/.config/rclone/rclone.conf"; fi
fi

if [ "$API_WAS_UP" = 1 ]; then
  log "starting voltai-api"
  sv up voltai-api
  for _ in $(seq 1 30); do curl -fsS -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
  curl -sS -m 10 "http://127.0.0.1:$PORT/api/health/ready" || true; echo
fi
[ "$WD_WAS_UP" = 1 ] && sv up voltai-watchdog >/dev/null 2>&1 || true
log "restore complete"
