#!/usr/bin/env bash
# Gate 1 — pull the 6 charger APKs off a connected phone (the version actually running).
# Better than scraping APKPure: exact installed build, split-APKs included.
#
# Prereqs:
#   - Install the 6 apps on the phone normally (Play Store / APKPure) and log in once.
#   - Phone: Developer options → USB debugging ON, connected; `adb devices` shows it.
#
# Usage:  bash scripts/gate/pull-apks.sh            # pulls into ./tmp/apks
#         OUT=/some/dir bash scripts/gate/pull-apks.sh
set -euo pipefail

OUT="${OUT:-tmp/apks}"
mkdir -p "$OUT"

# package name -> friendly slug (matches SourceId in src/types/station.ts)
declare -A PKGS=(
  [uz.tokbor.tokbor]=tokbor
  [com.fintech_projects.fintech_project1]=pro-tok
  [uz.spectreEnergy.uz]=spectre-energy
  [com.charging123.megawatt]=megawatt-energy
  [org.uicgroup.kwattapp]=k-watt
  [uz.beonapp.uz]=beon
)

if ! adb get-state >/dev/null 2>&1; then
  echo "No device via adb. Enable USB debugging and run: adb devices" >&2
  exit 1
fi

for pkg in "${!PKGS[@]}"; do
  slug="${PKGS[$pkg]}"
  echo "== $slug ($pkg) =="
  # `pm path` lists base + split APKs. We grab the base (or the single) APK.
  mapfile -t paths < <(adb shell pm path "$pkg" 2>/dev/null | tr -d '\r' | sed 's/^package://')
  if [ "${#paths[@]}" -eq 0 ]; then
    echo "  not installed — skipping"
    continue
  fi
  for p in "${paths[@]}"; do
    name="$(basename "$p")"
    # For pinning screening the base.apk (classes.dex + lib/) is what we need.
    if [[ "$name" == "base.apk" || "${#paths[@]}" -eq 1 ]]; then
      adb pull "$p" "$OUT/$slug.apk" >/dev/null && echo "  -> $OUT/$slug.apk"
    fi
  done
done

echo
echo "Done. Next: npx tsx scripts/gate/screen-apk.ts $OUT"
