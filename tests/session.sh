#!/usr/bin/env bash
# Runs inside the private D-Bus session of a test run (see run-headless.sh):
# installs the extension and starts a headless GNOME Shell with the
# automation script.
#
#   session.sh ZIP MODE SCENARIO

set -euo pipefail

zip=$1 mode=$2 scenario=$3
uuid=$(basename "$zip" .shell-extension.zip)

# GNOME Shell talks to logind, NetworkManager, polkit and others on the system
# bus. A private one keeps it away from those of the real session.
system_bus=$XDG_RUNTIME_DIR/system-bus
dbus-daemon --session --nofork --address="unix:path=$system_bus" &
system_bus_pid=$!
trap 'kill "$system_bus_pid" 2>/dev/null || true' EXIT
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=$system_bus
for _ in $(seq 50); do
    [ -S "$system_bus" ] && break
    sleep 0.1
done

if [ "$scenario" != baseline ]; then
    gnome-extensions install "$zip"
fi
if [ "$scenario" = startup ]; then
    gsettings set org.gnome.shell enabled-extensions "['$uuid']"
fi

DND_TEST_UUID=$uuid DND_TEST_SCENARIO=$scenario \
    gnome-shell --headless --no-x11 --virtual-monitor 1920x1080 \
    --mode="$mode" --automation-script="$(dirname "$0")/automation.js"
