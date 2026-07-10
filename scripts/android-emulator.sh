#!/bin/bash
# Android emulator management script
# Usage: ./scripts/android-emulator.sh <command>
# Commands: start, stop, install, launch, logcat, status
#
# start: Checks if emulator is already running, if yes uses it; if not, starts it
#        in background (output buffered) and prompts user to press Enter when ready.

set -e

ANDROID_SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/home/d/Android/Sdk}}"
AVD_NAME="Pixel_6a"
APP_PACKAGE="com.ctocrm.jsmastery"
APP_ACTIVITY="com.ctocrm.jsmastery.MainActivity"
EMULATOR_LOG="$(mktemp -t emu-boot.XXXXXX.log)"

# Timeout in seconds
TIMEOUT_SECONDS=300

# Get emulator serial dynamically
get_emulator_serial() {
    adb devices 2>/dev/null | grep 'emulator-' | head -1 | awk '{print $1}'
}

is_emulator_running() {
    adb shell getprop sys.boot_completed 2>/dev/null | grep -q 1
}

case "$1" in
    start)
        # Export display for emulator GUI
        export DISPLAY=${DISPLAY:-:0}
        if is_emulator_running; then
            echo "[EMULATOR] Emulator already running (detected boot completed)"
            SERIAL=$(get_emulator_serial)
            echo "[EMULATOR] Using emulator: ${SERIAL:-default}"
        else
            echo "[EMULATOR] No running emulator detected"
            echo "[EMULATOR] Starting $AVD_NAME..."
            # Start emulator in background, buffer output to log file
            # Using -no-snapshot-load to avoid potential snapshot corruption
            # Try with hardware acceleration and proper GPU
            "$ANDROID_SDK/emulator/emulator" -avd "$AVD_NAME" -no-snapshot-load -no-audio -skin pixel_6a -gpu host -accel on > "$EMULATOR_LOG" 2>&1 &
            sleep 2
            echo "[EMULATOR] Emulator process started in background"
            echo ""
            echo "=========================================="
            echo "[EMULATOR] Emulator is starting in background."
            echo "[EMULATOR] Please wait for the emulator to show the home screen."
            echo "[EMULATOR] Press Enter when the emulator is ready."
            echo "=========================================="
            echo ""
            read -p "[EMULATOR] Press Enter when the emulator is ready..." || true
            # Wait for device to be ready
            timeout 120 bash -c "until adb shell getprop sys.boot_completed 2>/dev/null | grep -q 1; do sleep 2; done" || true
            # Clean up log file
            rm -f "$EMULATOR_LOG"
        fi
        ;;
    
    stop)
        echo "[EMULATOR] Stopping $AVD_NAME..."
        EMULATOR_SERIAL=$(get_emulator_serial)
        if [ -n "$EMULATOR_SERIAL" ]; then
            adb -s "$EMULATOR_SERIAL" emu kill 2>/dev/null || true
        else
            adb emu kill 2>/dev/null || true
        fi
        echo "[EMULATOR] Emulator stopped"
        ;;
    
    install)
        APK_PATH="$2"
        if [ -z "$APK_PATH" ]; then
            echo "[EMULATOR] Error: APK path required"
            echo "Usage: $0 install /path/to/app-debug.apk"
            exit 1
        fi
        echo "[EMULATOR] Installing $APK_PATH..."
        # Try install, if insufficient storage, uninstall first and retry
        if ! adb install -r "$APK_PATH" 2>&1; then
            echo "[EMULATOR] Install failed, trying uninstall and retry..."
            adb uninstall "$APP_PACKAGE" 2>/dev/null || true
            adb install -r "$APK_PATH"
        fi
        echo "[EMULATOR] Install complete"
        ;;
    
    launch)
        echo "[EMULATOR] Launching $APP_PACKAGE..."
        adb shell am start -n "$APP_PACKAGE/$APP_ACTIVITY" 2>/dev/null || \
            adb shell monkey -p "$APP_PACKAGE" -c android.intent.category.LAUNCHER 1
        echo "[EMULATOR] App launched"
        ;;
    
    logcat)
        echo "[EMULATOR] Monitoring logcat (Ctrl+C to stop)..."
        adb logcat | grep -E "(ICON_AI|ReactNativeJS|RNTflite|jsmastery)" || true
        ;;
    
    status)
        if is_emulator_running; then
            SERIAL=$(get_emulator_serial)
            echo "[EMULATOR] Status: Running (${SERIAL:-default})"
        else
            echo "[EMULATOR] Status: Not running"
        fi
        ;;
    
    *)
        echo "Android Emulator Management Script"
        echo "Usage: $0 {start|stop|install|launch|logcat|status}"
        echo ""
        echo "Commands:"
        echo "  start   - Start the emulator AVD (uses existing if running, prompts if needs boot)"
        echo "  stop    - Stop the emulator"
        echo "  install - Install APK to emulator (requires path)"
        echo "  launch  - Launch the app on emulator"
        echo "  logcat  - Monitor logs for app messages"
        echo "  status  - Check if emulator is running"
        exit 1
        ;;
esac