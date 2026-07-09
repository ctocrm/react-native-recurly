#!/bin/bash
# Android verification script - builds, installs, and monitors the app on emulator
#
# Usage: ./scripts/verify-android.sh [--watch] [--force-model]
#
# Uses build-android.sh --dev internally which builds x86_64,
# installs on emulator, and launches the app.
# No hard timeout -- monitors indefinitely (Ctrl+C to stop).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

FORCE_MODEL=""
WATCH=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --force-model) FORCE_MODEL="--force-model"; shift ;;
        --watch)       WATCH="--watch"; shift ;;
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
"$SCRIPT_DIR/android-emulator.sh" start
echo ""

# Build with dev mode (x86_64 + install + launch)
echo "[VERIFY] Building with dev mode..."
"$SCRIPT_DIR/build-android.sh" --dev ${FORCE_MODEL:+$FORCE_MODEL} ${WATCH:+$WATCH}
echo ""

# Monitor logcat for key messages (no hard timeout, Ctrl+C to stop)
echo "[VERIFY] Monitoring app logs (Ctrl+C to stop)..."
echo "[VERIFY] Looking for: [ICON_AI] super-resolution model loaded"
echo "[VERIFY] Looking for: RNTflite"
echo ""
# Disable pipefail for interactive logcat monitoring (grep exits on SIGPIPE)
set +o pipefail 2>/dev/null || true
adb logcat | grep -E '(ICON_AI|RNTflite|super-resolution|jsmastery)' || true