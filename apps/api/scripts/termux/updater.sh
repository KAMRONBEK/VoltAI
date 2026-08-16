#!/data/data/com.termux/files/usr/bin/bash
# Pull-based continuous deployment for the phone (runs every 5 min as the `voltai-updater` service).
#
# GitHub cannot reach the phone, so CI does not push — it PUBLISHES: every green push to `main`
# creates a GitHub Release tagged `api-<shortsha>` (see .github/workflows/ci.yml) with the built
# API bundle + its sha256. This script polls the "latest" release, and when its commit differs from
# what is installed AND is a descendant of it, downloads + verifies the bundle and hands it to
# apply-update.sh (which restarts, smoke-tests and rolls back on failure). A release that failed to
# apply is remembered and never retried; the next release clears it.
#
# Controls in apps/api/.env:  AUTO_UPDATE=true|false   GITHUB_REPO=KAMRONBEK/VoltAI
# Optional ~/voltai/state/github-token (a fine-grained read-only token) raises the API rate limit /
# allows private repos; not needed for the public repo.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

[ "$(env_get AUTO_UPDATE true)" = "false" ] && { log "auto-update disabled (AUTO_UPDATE=false)"; exit 0; }
SLUG="$(env_get GITHUB_REPO KAMRONBEK/VoltAI)"
STATE="$HOME/voltai/state"; mkdir -p "$STATE/incoming"
BAD="$STATE/update-bad"

AUTH=()
[ -s "$STATE/github-token" ] && AUTH=(-H "Authorization: Bearer $(tr -d '\r\n' < "$STATE/github-token")")

json="$(curl -fsS -m 25 -H 'Accept: application/vnd.github+json' -H 'User-Agent: voltai-updater' "${AUTH[@]}" \
        "https://api.github.com/repos/$SLUG/releases/latest" 2>/dev/null)" || { log "GitHub not reachable / no release yet"; exit 0; }

TAG="$(printf '%s' "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.tag_name||"")}catch{}})')"
case "$TAG" in api-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;; *) log "latest release '$TAG' is not an api-* release"; exit 0 ;; esac
NEW="${TAG#api-}"

CUR="$(node -p "try{require('$API_DIR/dist/version.json').commit}catch(e){'none'}" 2>/dev/null || echo none)"
CUR_DIRTY="$(node -p "try{String(!!require('$API_DIR/dist/version.json').dirty)}catch(e){'false'}" 2>/dev/null || echo false)"

if [ "$NEW" = "$CUR" ]; then exit 0; fi
if grep -qx "$TAG" "$BAD" 2>/dev/null; then log "skipping $TAG (failed before)"; exit 0; fi
# Only move FORWARD: the release must be a descendant of the installed commit (protects a manual
# deploy of a newer commit from being "updated" back to an older release). A dirty manual deploy is
# keyed on its base commit; a release that descends from that base supersedes it.
if [ "$CUR" != "none" ] && git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$REPO" fetch -q origin 2>/dev/null || true
  if git -C "$REPO" cat-file -e "$CUR^{commit}" 2>/dev/null && git -C "$REPO" cat-file -e "$NEW^{commit}" 2>/dev/null; then
    if ! git -C "$REPO" merge-base --is-ancestor "$CUR" "$NEW" 2>/dev/null; then
      log "release $NEW is not a descendant of installed $CUR${CUR_DIRTY:+ (dirty=$CUR_DIRTY)} — not applying"
      exit 0
    fi
  else
    log "cannot relate installed $CUR to release $NEW in git history — not applying automatically"
    exit 0
  fi
fi
[ "$CUR_DIRTY" = "true" ] && log "installed build was a dirty manual deploy on $CUR; release $NEW supersedes it"

# ---- download + verify ---------------------------------------------------------------------
urls="$(printf '%s' "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);for(const a of j.assets||[])console.log(a.name+"\t"+a.browser_download_url)}catch{}})')"
TARURL="$(printf '%s\n' "$urls" | awk -F'\t' '$1 ~ /\.tar\.gz$/ {print $2; exit}')"
SHAURL="$(printf '%s\n' "$urls" | awk -F'\t' '$1 ~ /\.sha256$/ {print $2; exit}')"
[ -n "$TARURL" ] && [ -n "$SHAURL" ] || { warn "$TAG has no bundle/sha256 asset"; exit 0; }

log "new release $TAG (installed $CUR) — downloading"
DL="$STATE/incoming/$TAG.tar.gz"
curl -fsSL -m 600 --retry 3 -o "$DL" "$TARURL" && curl -fsSL -m 60 -o "$DL.sha256" "$SHAURL" \
  || { warn "download failed"; rm -f "$DL" "$DL.sha256"; exit 0; }
( cd "$STATE/incoming" && sed "s#[^ ]*\$#$TAG.tar.gz#" "$TAG.tar.gz.sha256" | sha256sum -c --quiet - ) \
  || { warn "checksum mismatch for $TAG — refusing"; echo "$TAG" >> "$BAD"; rm -f "$DL" "$DL.sha256"; exit 0; }

if bash "$API_DIR/scripts/termux/apply-update.sh" "$DL"; then
  log "auto-update to $TAG succeeded"
  rm -f "$DL" "$DL.sha256"
  # Keep the last few bundles for forensics/rollback; drop older ones.
  ls -1t "$STATE"/incoming/*.tar.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
else
  warn "auto-update to $TAG FAILED (rolled back) — will not retry this release"
  echo "$TAG" >> "$BAD"
fi
