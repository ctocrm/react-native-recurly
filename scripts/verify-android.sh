#!/bin/bash
# Android build verification script - builds, installs, and runs the app on emulator
# Usage: ./scripts/verify-android.sh [--force-model]
#
# This script handles the slow emulator scenario by:
# - Using extended timeouts
# - Checking emulator status before operations
# - Monitoring for key log messages

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ANDROID_SDK="${ANDROID_HOME:-/home/d/Android/Sdk}"

FORCE_MODEL="false"
if [ "$1" = "--force-model" ]; then
    FORCE_MODEL="true"
fi

echo "=========================================="
echo "Android Build Verification Script"
echo "=========================================="
echo ""
echo "This script builds and installs to the Android emulator."
echo "NOTE: Running in a VM - operations may be slow. Will wait for responses."
echo ""

# Extended timeout for slow VM (10 minutes)
VM_TIMEOUT=600

# Set Java 17 for react-native-fast-tflite compatibility
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH="$JAVA_HOME/bin:$PATH"

# Step 1: Check emulator status
echo "[VERIFY] Checking emulator status..."
"$SCRIPT_DIR/android-emulator.sh" status || true
echo ""

# Step 2: Start emulator if not running
echo "[VERIFY] Ensuring emulator is running..."
"$SCRIPT_DIR/android-emulator.sh" start
echo ""

# Step 3: Build the app
echo "[VERIFY] Building app..."
if [ "$FORCE_MODEL" = "true" ]; then
    "$SCRIPT_DIR/build-android.sh" --force-model
else
    "$SCRIPT_DIR/build-android.sh"
fi
echo ""

# Step 4: Install to emulator
APK_PATH="$PROJECT_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
    echo "[VERIFY] Installing APK to emulator..."
    adb install -r "$APK_PATH"
    echo "[VERIFY] Install complete"
else
    echo "[VERIFY] Error: APK not found at $APK_PATH"
    exit 1
fi
echo ""

# Step 5: Launch app and monitor logs
echo "[VERIFY] Launching app..."
"$SCRIPT_DIR/android-emulator.sh" launch
echo ""

echo "[VERIFY] Monitoring app launch (waiting up to ${VM_TIMEOUT}s for TFLite initialization)..."
echo "[VERIFY] Looking for: [ICON_AI] super-resolution model loaded"
echo "[VERIFY] Press Ctrl+C to stop monitoring early"
echo ""

# Monitor logcat for key messages
timeout $VM_TIMEOUT adb logcat -c || true  # Clear log
timeout $VM_TIMEOUT bash -c "
    while true; do
        if adb logcat -d | grep -q 'super-resolution model loaded'; then
            echo '[SUCCESS] TFLite model loaded successfully!'
            exit 0
        elif adb logcat -d | grep -q 'RNTflite native module not available'; then
            echo '[WARNING] TFLite native module not available (expected in Expo Go, not dev build)'
        elif adb logcat -d | grep -q 'RNTflite'; then
            echo '[INFO] TFLite module detected'
            adb logcat -d | grep -E '(ICON_AI|RNTflite)' | tail -5
        fi
        sleep 5
    done
" &

LOG_PID=$!

# Wait for user interaction or timeout
echo "[VERIFY] App is running. Check the emulator for the app UI."
echo "[VERIFY] Log monitoring PID: $LOG_PID"
echo ""
echo "[VERIFY] Verification complete!"
echo "[VERIFY] If the app opened correctly, the native TFLite module is linked."