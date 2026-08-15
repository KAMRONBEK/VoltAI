#!/data/data/com.termux/files/usr/bin/sh
# Termux:Boot entry — installed as ~/.termux/boot/00-voltai by install-boot.sh.
# (Launch the Termux:Boot app once after installing it so its boot receiver is registered.)
#
# 1. Hold a wake lock so Android does not deep-sleep the server (Wi-Fi + CPU stay up).
# 2. Start termux-services' supervisor via ITS OWN idempotent starter (pidfile-tracked), which
#    brings up every enabled service (voltai-api, voltai-watchdog, voltai-backup, cloudflared,
#    sshd). Do NOT exec runsvdir directly here: the first interactive login after boot would then
#    start a SECOND supervisor tree over the same service dir.
#
# Android note: on a phone with a lock-screen PIN, Termux's storage is credential-encrypted and
# BOOT_COMPLETED is only delivered after the FIRST UNLOCK — this script cannot run before someone
# unlocks the phone once. The server phone should therefore have Screen lock = None/Swipe
# (RUNBOOK §1), otherwise every unattended reboot needs a human.
termux-wake-lock
# No API process can exist at boot time, so any SQLite lock directory / pid record left by the
# reboot is stale by definition — clear it here (the app also does this, but a reused pid could
# make its owner check hesitate). Reads SQLITE_PATH from apps/api/.env; falls back to the default.
_env="$HOME/VoltAI/apps/api/.env"
_db="$(grep -E '^[[:space:]]*SQLITE_PATH=' "$_env" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -e "s/^['\"]//" -e "s/['\"]$//")"
[ -n "$_db" ] || _db="$HOME/voltai/data/voltai.sqlite"
rm -rf "$_db.lock" "$_db.pid" 2>/dev/null || true
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export SVDIR="$PREFIX/var/service"
export LOGDIR="$PREFIX/var/log"
mkdir -p "$PREFIX/var/run" "$LOGDIR"
service-daemon start
