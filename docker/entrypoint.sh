#!/bin/sh
set -e

echo "=================================================="
echo " Starting GPS-Mock Engine (v3 - Docker)          "
echo "=================================================="
echo "Driver:    ${GPSMOCK_DRIVER:-pymobiledevice (default)}"
echo "Transport: ${GPSMOCK_TRANSPORT:-auto (default)}"
echo "Listen:    ${GPSMOCK_ADDR:-:8080}"
echo "=================================================="

# Diagnostic checks for USB transport
if [ "${GPSMOCK_TRANSPORT}" = "usb" ]; then
    if [ ! -S /var/run/usbmuxd ]; then
        echo "WARNING: /var/run/usbmuxd socket not found! Did you mount it from the host?"
        echo "         e.g. -v /var/run/usbmuxd:/var/run/usbmuxd"
    else
        echo "Found usbmuxd socket."
    fi

    # Check for TUN device when tunnel creation is expected
    if [ "${GPSMOCK_NO_TUNNEL}" != "1" ] && [ "${GPSMOCK_NO_TUNNEL}" != "true" ]; then
        if [ ! -c /dev/net/tun ]; then
            echo "WARNING: /dev/net/tun device not found! Tunnel start may fail."
            echo "         Ensure you run with --cap-add=NET_ADMIN --device=/dev/net/tun (or --privileged)."
        else
            echo "Found TUN device."
        fi
    fi
fi

# Execute the Go engine binary passing all arguments
exec /usr/local/bin/gpsmock-engine "$@"
