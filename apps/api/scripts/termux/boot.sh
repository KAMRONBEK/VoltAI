#!/data/data/com.termux/files/usr/bin/sh
# Termux:Boot entry — symlink or copy this to ~/.termux/boot/00-voltai and `chmod +x` it.
# (Launch the Termux:Boot app once after install so its boot receiver is registered.)
#
# Holds a wake lock so Android doesn't deep-sleep the server, then hands off to runit,
# which brings up the enabled services (voltai-api, cloudflared).

# FIRST: keep the CPU + Wi-Fi awake. Release later with termux-wake-unlock if ever needed.
termux-wake-lock

# Start the runit supervision tree (termux-services). runsvdir keeps services up.
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
exec runsvdir "$PREFIX/var/service"
