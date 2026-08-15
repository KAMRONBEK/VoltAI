#!/data/data/com.termux/files/usr/bin/bash
# Install the Termux:Boot hook so the supervisor (and with it every enabled service) starts on
# boot without anyone opening Termux. Idempotent.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

have service-daemon || die "termux-services is not installed (pkg install termux-services)"
[ -f "$API_DIR/scripts/termux/boot.sh" ] || die "boot.sh not found under $API_DIR/scripts/termux"

mkdir -p "$HOME/.termux/boot"
# Copy (not symlink): the boot dir must keep working even if the checkout is moved/reset.
cp "$API_DIR/scripts/termux/boot.sh" "$HOME/.termux/boot/00-voltai"
chmod +x "$HOME/.termux/boot/00-voltai"

log "installed $HOME/.termux/boot/00-voltai"
cat <<'EOF'

Next (one-time, on the phone itself / via adb):
  * Open the Termux:Boot app ONCE (this registers its BOOT_COMPLETED receiver).
  * Settings → Apps → Termux, Termux:Boot, Termux:API → Battery → Unrestricted; allow autostart.
  * Settings → Security → Screen lock → None or Swipe (a PIN blocks Termux:Boot until first unlock).
  * Developer options → Stay awake while charging; disable "Auto-install system updates".
  * Android 12+ phantom-process killer, via adb from a PC:
      adb shell "/system/bin/device_config set_sync_disabled_for_tests persistent"
      adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"
      adb shell "settings put global settings_enable_monitor_phantom_procs false"
      adb shell "dumpsys deviceidle whitelist +com.termux"
  * Then TEST: reboot the phone and, without touching it, confirm
      curl -s http://127.0.0.1:8080/api/health/ready   (over adb forward / ssh) answers 200.
EOF
