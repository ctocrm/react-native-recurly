#!/bin/bash
# Android verification script - builds, installs, and monitors the app on emulator
#
# Usage: ./scripts/verify-android.sh [--dev] [--watch] [--force-model] [--device <name>] [--cache]
#
#   (default)  Self-contained build: builds x86_64 with embedded bundle,
#              installs on emulator, launches (no dev server needed).
#   --dev      Dev client mode: builds x86_64, installs, launches `npx expo start`
#              (Metro) so the app connects to the dev server.
#   --device <name>  Use specific AVD (overrides smart selection)
#   --cache         Cache AVD name for next run
#
# No hard timeout -- monitors indefinitely (Ctrl+C to stop).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

FORCE_MODEL=""
WATCH=""
DEV_MODE=""
DEVICE_NAME=""
CACHE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --force-model) FORCE_MODEL="--force-model"; shift ;;
        --watch)       WATCH="--watch"; shift ;;
        --dev)         DEV_MODE="--dev"; shift ;;
        --cache)       CACHE="--cache"; shift ;;
        --device|--avd)
            DEVICE_NAME="$2"
            shift 2
            ;;
        *)             echo "[VERIFY] Unknown option: $1"; exit 1 ;;
    esac
done

echo "=========================================="
echo "Android Build Verification Script"
echo "=========================================="
echo ""

# Check emulator
echo "[VERIFY] Checking emulator..."
"$SCRIPT_DIR/android-emulator.sh" status || true
if [ -n "$CACHE" ]; then
    export EMULATOR_CACHE=1
fi
"$SCRIPT_DIR/android-emulator.sh" start "$DEVICE_NAME"
echo ""

# Build (dev client or self-contained) + install + launch
if [ -n "$DEV_MODE" ]; then
    echo "[VERIFY] Building dev client (connects to Metro)..."
    "$SCRIPT_DIR/build-android.sh" --dev ${FORCE_MODEL:+$FORCE_MODEL} ${WATCH:+$WATCH} ${CACHE:+$CACHE} $DEVICE_NAME
else
    echo "[VERIFY] Building self-contained APK..."
    "$SCRIPT_DIR/build-android.sh" --arch x86_64 --install ${FORCE_MODEL:+$FORCE_MODEL} ${WATCH:+$WATCH} ${CACHE:+$CACHE} $DEVICE_NAME
fi
echo ""

# If dev mode, build-android.sh already started the Metro server in foreground,
# so we don't reach here until the user stops it. For self-contained mode we
# monitor logcat for key messages.
if [ -z "$DEV_MODE" ]; then
    echo "[VERIFY] Monitoring app logs (Ctrl+C to stop)..."
    echo "[VERIFY] Looking for: [ICON_AI] super-resolution model loaded"
    echo "[VERIFY] Looking for: RNTflite"
    echo ""
    # Disable pipefail for interactive logcat monitoring (grep exits on SIGPIPE)
    set +o pipefail 2>/dev/null || true
    adb logcat | grep -E '(ICON_AI|RNTflite|super-resolution|jsmastery)' || true
fi
