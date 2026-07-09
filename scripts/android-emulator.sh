#!/bin/bash
# Android emulator management script
# Usage: ./scripts/android-emulator.sh <command>
# Commands: start, stop, install, launch, logcat, status

set -e

ANDROID_SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/home/d/Android/Sdk}}"
AVD_NAME="Pixel_6a"
APP_PACKAGE="com.ctocrm.jsmastery"
APP_ACTIVITY="com.ctocrm.jsmastery.MainActivity"

# Timeout in seconds (extended for slow VM)
TIMEOUT_SECONDS=300

run_cmd() {
    echo "[EMULATOR] $1"
    eval "$1"
}

wait_for_device() {
    echo "[EMULATOR] Waiting for device to be ready..."
    timeout $TIMEOUT_SECONDS bash -c "until adb shell getprop sys.boot_completed | grep -q 1; do sleep 2; done"
    echo "[EMULATOR] Device booted, waiting for system UI..."
    timeout $TIMEOUT_SECONDS bash -c "until adb shell getprop sys.uiopened 2>/dev/null | grep -q 1; do sleep 2; done || true"
    echo "[EMULATOR] Device ready"
}

case "$1" in
    start)
        if adb shell getprop sys.boot_completed 2>/dev/null | grep -q 1; then
            echo "[EMULATOR] Device already running"
        else
            echo "[EMULATOR] Starting $AVD_NAME..."
            "$ANDROID_SDK/emulator/emulator" -avd "$AVD_NAME" -no-snapshot -no-audio -no-boot-anim -accel off &
            sleep 5
            wait_for_device
        fi
        ;;
    
    stop)
        echo "[EMULATOR] Stopping $AVD_NAME..."
        # Get the first emulator serial dynamically
        EMULATOR_SERIAL=$(adb devices | grep 'emulator-' | head -1 | awk '{print $1}')
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
        adb install -r "$APK_PATH"
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
        if adb shell getprop sys.boot_completed 2>/dev/null | grep -q 1; then
            echo "[EMULATOR] Status: Running"
        else
            echo "[EMULATOR] Status: Not running"
        fi
        ;;
    
    *)
        echo "Android Emulator Management Script"
        echo "Usage: $0 {start|stop|install|launch|logcat|status}"
        echo ""
        echo "Commands:"
        echo "  start   - Start the emulator AVD (waits for boot)"
        echo "  stop    - Stop the emulator"
        echo "  install - Install APK to emulator (requires path)"
        echo "  launch  - Launch the app on emulator"
        echo "  logcat  - Monitor logs for app messages"
        echo "  status  - Check if emulator is running"
        exit 1
        ;;
esac