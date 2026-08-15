#!/data/data/com.termux/files/usr/bin/bash
# Nightly backup of the phone's irreplaceable state — runs as the `voltai-backup` runit service at
# 03:00 (or by hand: bash apps/api/scripts/termux/backup.sh).
#
# What goes into the archive:
#   voltai.sqlite         the DB — taken from the API's own `VACUUM INTO` snapshot
#                         (SNAPSHOT_DIR/voltai-snapshot.sqlite, written daily at 02:30 and after boot).
#                         The live file is NEVER copied while the API runs: node-sqlite3-wasm's
#                         directory locks and the sqlite3 CLI's POSIX locks are invisible to each
#                         other, so a "hot copy" could be torn or even roll our journal back.
#   auth-tokens.json      operator login-replay bearer tokens (Tokbor/Beon/Pro-Tok)
#   tokbor-details.json   per-station Tokbor name/price cache
#   env                   apps/api/.env (INGEST_TOKEN, MYTAXI_API_KEY, paths…)
#   cloudflared/          ~/.cloudflared/* (tunnel credentials / token / config)
#   rclone.conf           the rclone remote definition, if any
#   MANIFEST.txt/.sha256  row counts + checksums so a restore is verified, not trusted
#
# The tarball is ENCRYPTED (openssl aes-256-cbc, pbkdf2) with the passphrase in
# ~/voltai/backup.passphrase (created by bootstrap.sh — keep a copy OFF the phone; without it the
# archives are unreadable). Copies go to: ~/voltai/backups (local), ~/storage/shared/VoltAI-backups
# (survives a Termux reinstall) and, if BACKUP_REMOTE is set in .env, an rclone remote.
# Old copies (> BACKUP_RETENTION_DAYS, default 14) are pruned everywhere.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

SQLITE_PATH="$(sqlite_path)"
AUTH_TOKENS_PATH="$(auth_tokens_path)"
TOKBOR_DETAILS_PATH="$(tokbor_details_path)"
SNAPSHOT="$(snapshot_dir)/voltai-snapshot.sqlite"
REMOTE="$(env_get BACKUP_REMOTE "")"
RETENTION_DAYS="$(env_get BACKUP_RETENTION_DAYS 14)"
PASSFILE="$HOME/voltai/backup.passphrase"
SHARED_DIR="$HOME/storage/shared/VoltAI-backups"
PORT="$(api_port)"

have sqlite3 || die "sqlite3 CLI missing (pkg install sqlite)"
have openssl || die "openssl missing (pkg install openssl-tool)"
[ -s "$PASSFILE" ] || die "no passphrase at $PASSFILE — run bootstrap.sh (and store the passphrase off-phone)"

# The API writes its own snapshots (src/index.ts scheduleSnapshot); this script never copies the
# live DB while ANY API process could be alive. If today's snapshot is missing/old (>36 h) and no
# API process exists (runit says down AND no node process AND no live pid file), a cold copy of the
# quiescent file is safe.
snapshot_age_h() { [ -f "$SNAPSHOT" ] && echo $(( ( $(date +%s) - $(stat -c %Y "$SNAPSHOT") ) / 3600 )) || echo 9999; }
api_alive() {
  sv status voltai-api 2>/dev/null | grep -q '^run:' && return 0
  pgrep -f 'node .*dist/src/index.js' >/dev/null 2>&1 && return 0
  [ -f "$SQLITE_PATH.pid" ] && kill -0 "$(cat "$SQLITE_PATH.pid" 2>/dev/null)" 2>/dev/null && return 0
  return 1
}
if [ "$(snapshot_age_h)" -gt 36 ]; then
  if api_alive; then
    warn "snapshot is $(snapshot_age_h)h old and an API process is alive — cannot safely copy the live DB; backing up tokens/config only"
    SNAPSHOT=""
  elif [ -f "$SQLITE_PATH" ]; then
    # No API process: the live file is quiescent, a CLI .backup is safe now (the sqlite3 CLI does
    # not use the wasm VFS's lock directory, so it needs no clearing here).
    warn "API is down; taking a cold copy of $SQLITE_PATH"
    mkdir -p "$(dirname "$SNAPSHOT")"
    sqlite3 "$SQLITE_PATH" ".backup '$SNAPSHOT'"
  else
    warn "no DB and no snapshot — backing up tokens/config only"
    SNAPSHOT=""
  fi
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="voltai-$STAMP"
STAGE="$BACKUP_DIR/$NAME"
mkdir -p "$STAGE" "$BACKUP_DIR"
trap 'rm -rf "$STAGE"' EXIT

STATIONS="?"
if [ -n "$SNAPSHOT" ]; then
  cp -p "$SNAPSHOT" "$STAGE/voltai.sqlite"
  # Integrity gate: a corrupt copy is worse than no copy because it hides the loss.
  sqlite3 "$STAGE/voltai.sqlite" 'PRAGMA integrity_check;' | grep -qx 'ok' || die "snapshot fails integrity_check — aborting"
  STATIONS="$(sqlite3 "$STAGE/voltai.sqlite" 'SELECT COUNT(*) FROM stations;' 2>/dev/null || echo '?')"
  # Sanity vs the live API: a snapshot with far fewer stations than the API serves is suspicious.
  LIVE="$(curl -sS -m 10 "http://127.0.0.1:$PORT/api/health/detail" 2>/dev/null | sed -n 's/.*"stations":\([0-9]*\).*/\1/p' || true)"
  if [ -n "$LIVE" ] && [ "$STATIONS" != "?" ] && [ "$LIVE" -gt 0 ] && [ "$STATIONS" -lt $((LIVE / 2)) ]; then
    warn "snapshot has $STATIONS stations but the API serves $LIVE — snapshot may be stale (still archived)"
  fi
fi

for f in "$AUTH_TOKENS_PATH" "$TOKBOR_DETAILS_PATH"; do
  if [ -f "$f" ]; then cp -p "$f" "$STAGE/"; else warn "$f absent — not in this archive"; fi
done
[ -f "$ENV_FILE" ] && cp -p "$ENV_FILE" "$STAGE/env"
if [ -d "$HOME/.cloudflared" ]; then mkdir -p "$STAGE/cloudflared" && cp -p "$HOME"/.cloudflared/* "$STAGE/cloudflared/" 2>/dev/null || true; fi
[ -f "$HOME/.config/rclone/rclone.conf" ] && cp -p "$HOME/.config/rclone/rclone.conf" "$STAGE/rclone.conf"

( cd "$STAGE" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256 )
{
  echo "created=$STAMP"
  echo "stations_rows=$STATIONS"
  echo "snapshot=${SNAPSHOT:-none}"
  echo "sqlite_path=$SQLITE_PATH"
  echo "auth_tokens_path=$AUTH_TOKENS_PATH"
  echo "tokbor_details_path=$TOKBOR_DETAILS_PATH"
  echo "retention_days=$RETENTION_DAYS"
  echo "commit=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
} > "$STAGE/MANIFEST.txt"

ARCHIVE="$BACKUP_DIR/$NAME.tar.gz.enc"
log "packing + encrypting -> $ARCHIVE (stations=$STATIONS)"
tar -C "$BACKUP_DIR" -czf - "$NAME" | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$PASSFILE" -out "$ARCHIVE"
rm -rf "$STAGE"; trap - EXIT
# Relative name inside the .sha256 so the pair verifies wherever it is copied (shared storage,
# rclone remote, a replacement phone) — an absolute path would point back at this directory.
( cd "$BACKUP_DIR" && sha256sum "$NAME.tar.gz.enc" > "$NAME.tar.gz.enc.sha256" )

# Second local copy on shared storage (needs `termux-setup-storage` once).
if [ -d "$HOME/storage/shared" ]; then
  mkdir -p "$SHARED_DIR" && cp -p "$ARCHIVE" "$ARCHIVE.sha256" "$SHARED_DIR/" && log "copied to $SHARED_DIR"
fi

# Off-phone copy.
if [ -n "$REMOTE" ]; then
  if have rclone; then
    log "uploading to $REMOTE"
    rclone copy "$ARCHIVE" "$REMOTE/" --no-traverse && rclone copy "$ARCHIVE.sha256" "$REMOTE/" --no-traverse \
      || warn "rclone upload failed — the local copies still exist"
    rclone delete "$REMOTE/" --include 'voltai-*.tar.gz.enc*' --min-age "${RETENTION_DAYS}d" 2>/dev/null || true
  else
    warn "BACKUP_REMOTE set but rclone missing (pkg install rclone)"
  fi
else
  warn "BACKUP_REMOTE unset — no off-phone copy. Set it in .env (rclone config first)."
fi

# Prune local copies.
find "$BACKUP_DIR" -maxdepth 1 -name 'voltai-*.tar.gz.enc*' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
[ -d "$SHARED_DIR" ] && find "$SHARED_DIR" -maxdepth 1 -name 'voltai-*.tar.gz.enc*' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true

log "done: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
