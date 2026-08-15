#!/data/data/com.termux/files/usr/bin/bash
# Shared helpers for the phone-side scripts. Source it:  . "$(dirname "$0")/lib.sh"
#
# Conventions (all absolute — never rely on ~ or $HOME expansion inside .env):
#   REPO      /data/data/com.termux/files/home/VoltAI          the git checkout
#   API_DIR   $REPO/apps/api                                    cwd of the API process
#   DATA_DIR  /data/data/com.termux/files/home/voltai/data      SQLite + token/detail JSONs
#   LOG_DIR   /data/data/com.termux/files/home/voltai/logs      svlogd output per service
#   BACKUP_DIR /data/data/com.termux/files/home/voltai/backups  local backup archives

: "${PREFIX:=/data/data/com.termux/files/usr}"
: "${HOME:=/data/data/com.termux/files/home}"
export PREFIX HOME
export SVDIR="${SVDIR:-$PREFIX/var/service}"
export LOGDIR="${LOGDIR:-$PREFIX/var/log}"

REPO="${REPO:-$HOME/VoltAI}"
API_DIR="$REPO/apps/api"
DATA_DIR="${DATA_DIR:-$HOME/voltai/data}"
LOG_DIR="${LOG_DIR:-$HOME/voltai/logs}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/voltai/backups}"
ENV_FILE="$API_DIR/.env"

# Read ONE key from .env without shell-sourcing it (no glob expansion, no command execution,
# CRLF-safe, strips surrounding quotes). Mirrors what dotenv does closely enough for paths/tokens.
env_get() {  # env_get KEY [default]
  local key="$1" default="${2:-}" line value
  if [ -f "$ENV_FILE" ]; then
    # Accepts `KEY=v`, `export KEY=v`, `KEY = v` (all valid for dotenv); last one wins.
    line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$ENV_FILE" | tail -n1 || true)"
    if [ -n "$line" ]; then
      value="${line#*=}"
      value="$(printf '%s' "$value" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
      case "$value" in
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
        *)  # unquoted: dotenv stops at ` #` (inline comment)
            value="$(printf '%s' "$value" | sed -e 's/[[:space:]]#.*$//' -e 's/[[:space:]]*$//')" ;;
      esac
      if [ -n "$value" ]; then printf '%s' "$value"; return 0; fi
    fi
  fi
  printf '%s' "$default"
}

# Relative paths in .env are resolved by the app against apps/api (its cwd) — resolve ours the same
# way instead of against whatever directory runit or the operator happened to be in.
cd "$API_DIR" 2>/dev/null || true

# Effective paths — identical defaults to the code (src/db/sqlite.ts, scrapers/auth/tokenStore.ts,
# scrapers/apps/tokborDetailCache.ts): blank == unset == ./data/<file> relative to API_DIR.
sqlite_path()        { env_get SQLITE_PATH "$API_DIR/data/voltai.sqlite"; }
auth_tokens_path()   { env_get AUTH_TOKENS_PATH "$API_DIR/data/auth-tokens.json"; }
tokbor_details_path(){ env_get TOKBOR_DETAILS_PATH "$API_DIR/data/tokbor-details.json"; }
snapshot_dir()       { env_get SNAPSHOT_DIR "$(dirname "$(sqlite_path)")/snapshots"; }
api_port()           { env_get PORT 8080; }

log()  { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
warn() { printf '[%s] WARN: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
die()  { printf '[%s] ERROR: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# Is termux-services' runsvdir up? (service-daemon tracks it by pidfile.)
runsvdir_running() {
  local pidfile="$PREFIX/var/run/service-daemon.pid" pid
  [ -f "$pidfile" ] || return 1
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

ensure_runsvdir() {
  if ! runsvdir_running; then
    log "starting runsvdir (service-daemon)"
    service-daemon start >/dev/null 2>&1 || true
    sleep 2
  fi
  runsvdir_running || warn "runsvdir does not seem to be running (open a new Termux session or run: service-daemon start)"
}

# `sv status` for one service, tolerant of a not-yet-scanned service dir.
sv_state() { sv status "$1" 2>/dev/null || echo "$1: (not supervised yet)"; }
