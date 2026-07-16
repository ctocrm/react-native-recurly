#!/bin/bash
# Interactive Android Build Script
# Builds one arch at a time (sequential) with live monitoring
#
# Usage:
#   ./scripts/build-android.sh                    # Self-contained build, all archs (default)
#   ./scripts/build-android.sh --arch x86_64      # Build a specific arch (self-contained)
#   ./scripts/build-android.sh --arch x86_64 --install   # Build + install on emulator
#   ./scripts/build-android.sh --arch x86_64 --device pixel_6a  # Use specific AVD
#   ./scripts/build-android.sh --dev              # Dev client: x86_64 + expo start + install + launch
#   ./scripts/build-android.sh --dev --watch      # Dev client with live monitor + expo server
#   ./scripts/build-android.sh --parallel N       # Build all with N workers
#
# Modes:
#   (default)  Self-contained release-style APK: the JS bundle is embedded via
#              gradle assembleRelease (NO Metro/dev server needed).
#   --dev      Development client: builds debug APK and launches `npx expo start`
#              (Metro) so the app connects to the dev server for live reload.
#
# Options:
#   --arch all|x86_64|arm64-v8a|armeabi-v7a|x86   Architecture to build (default: all)
#   --dev                                         Dev client mode (x86_64 + expo start + install + launch)
#   --install                                     Install APK on emulator after build (self-contained mode only)
#   --parallel N                                  Workers per arch (default: 1)
#   (removed) --force-model was moved to `npm run train:models:force`
#   --watch                                       Enable live build monitoring
#   --clean                                       Clean prebuild (expo prebuild --clean)
#   --device|--avd <name>                         Use specific AVD (overrides smart selection)
#   --cache                                       Cache AVD name for next run (sets EMULATOR_CACHE=1)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ANDROID_SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/home/d/Android/Sdk}}"

# Defaults
ARCH_LIST=("arm64-v8a" "armeabi-v7a" "x86" "x86_64")
ARCH_TARGET="all"
PARALLEL=1
WATCH=false
CLEAN=false
DEV_MODE=false
DO_INSTALL=false
DEVICE_NAME=""
CACHE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --arch)
            ARCH_TARGET="$2"
            shift 2
            ;;
        --dev)
            DEV_MODE=true
            ARCH_TARGET="x86_64"
            shift
            ;;
        --install)
            DO_INSTALL=true
            shift
            ;;
        --parallel)
            PARALLEL="$2"
            shift 2
            ;;
        --watch)
            WATCH=true
            shift
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        --device|--avd)
            DEVICE_NAME="$2"
            shift 2
            ;;
        --cache)
            CACHE=true
            shift
            ;;
        *)
            echo "[BUILD] Unknown option: $1"
            exit 1
            ;;
    esac
done

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
export PATH="$JAVA_HOME/bin:$PATH"

# Determine which archs to build
if [ "$ARCH_TARGET" = "all" ]; then
    BUILD_ARCHS=("${ARCH_LIST[@]}")
elif [ "$ARCH_TARGET" = "x86_64" ] || [ "$ARCH_TARGET" = "x86" ] || [ "$ARCH_TARGET" = "arm64-v8a" ] || [ "$ARCH_TARGET" = "armeabi-v7a" ]; then
    BUILD_ARCHS=("$ARCH_TARGET")
else
    echo "[BUILD] Unknown architecture: $ARCH_TARGET"
    echo "[BUILD] Valid options: all, x86_64, x86, arm64-v8a, armeabi-v7a"
    exit 1
fi

# ---------------------------------------------------------------------------
# NODE_ENV controls whether the JS bundle is embedded into the APK.
#   production  -> bundle is embedded (self-contained, no Metro needed)
#   (unset)     -> dev client connects to `npx expo start` (Metro)
# ---------------------------------------------------------------------------
if [ "$DEV_MODE" = "true" ]; then
    echo "[BUILD] Dev client mode: bundle will connect to Metro (npx expo start)"
    unset NODE_ENV
else
    echo "[BUILD] Self-contained mode: embedding JS bundle via gradle assembleRelease"
    export NODE_ENV=production
fi

# Step 0: Ensure AVD exists (detect or create BEFORE building) and capture its name.
# The captured AVD_NAME is passed to the emulator `start` later so we never
# prompt-with-no-AVD (the create step has already finished by then).
AVD_NAME=""
if [ "$DO_INSTALL" = "true" ] || [ "$DEV_MODE" = "true" ]; then
    echo ""
    echo "[BUILD] Step 0: Checking for Android emulator AVD..."
    if [ -n "$DEVICE_NAME" ]; then
        # Specific AVD requested - use it directly
        AVD_NAME="$DEVICE_NAME"
        echo "[BUILD] Using specified AVD: $AVD_NAME"
        export EMULATOR_CACHE=1
    else
        # Detect existing AVDs or create one with visible progress
        AVD_CHECK=$("$SCRIPT_DIR/android-emulator.sh" list 2>/dev/null | sed '1d' | head -1)
        if [ -z "$AVD_CHECK" ]; then
            echo "[BUILD] No AVD found. Creating one now (interactive: device/API/ABI, may download a system image)..."
            if [ "$CACHE" = "true" ]; then
                export EMULATOR_CACHE=1
            fi
            # Capture the created AVD name. create_avd echoes the AVD name as
            # its final stdout line, but the wrapper's "is ready" message is
            # appended afterwards, so we extract the name reliably from the
            # "AVD '<name>' CREATED SUCCESSFULLY" marker instead of line position.
            CREATE_OUTPUT=$(mktemp)
            "$SCRIPT_DIR/android-emulator.sh" create > "$CREATE_OUTPUT"
            AVD_NAME=$(grep -oP "AVD '\K[^']+(?=' CREATED SUCCESSFULLY)" "$CREATE_OUTPUT" | head -1)
            if [ -z "$AVD_NAME" ]; then
                # Fallback: the bare AVD name line emitted by create_avd itself.
                AVD_NAME=$(grep -E "^[a-zA-Z0-9_.-]+_API[0-9]+$" "$CREATE_OUTPUT" | head -1)
            fi
            cat "$CREATE_OUTPUT"
            rm -f "$CREATE_OUTPUT"
            echo "[BUILD] Created AVD: $AVD_NAME"
        else
            AVD_NAME="$AVD_CHECK"
            echo "[BUILD] Found AVD: $AVD_NAME"
            if [ "$CACHE" = "true" ]; then
                echo "$AVD_NAME" > ".emulator-device"
                export EMULATOR_CACHE=1
            fi
        fi
    fi
    # Make the resolved AVD name available to the emulator start calls below.
    export AVD_NAME
fi

# Step 1: Regenerate the static require() map from whatever *.tflite files
# exist in assets/models/. This guarantees the bundle only references models
# that are physically present (so the build never fails on missing models).
#
# Model training has been separated out — run `npm run train:setup && npm run train:models`
# separately if you need to generate or update the upscaling models.
echo ""
echo "[BUILD] Step 1: Regenerating model map from assets/models/..."
node "$SCRIPT_DIR/generate-model-map.js"


# Step 2: Prebuild Android project
echo ""
echo "[BUILD] Step 2: Expo Prebuild (Android)"
if [ "$CLEAN" = "true" ]; then
    npx expo prebuild --clean --platform android
else
    npx expo prebuild --platform android
fi

# Define BUILD_DIR early
BUILD_DIR="$PROJECT_ROOT/android"

# Step 3: Build each architecture one at a time (sequential) to avoid CPU hammering
echo ""
echo "[BUILD] Step 3: Building ${#BUILD_ARCHS[@]} arch(s) one at a time"

JVM_ARGS="-Xmx4096m -XX:MaxMetaspaceSize=512m"
if [ "$PARALLEL" -le 1 ]; then
    JVM_ARGS="$JVM_ARGS -Dorg.gradle.workers.max=1"
else
    JVM_ARGS="$JVM_ARGS -Dorg.gradle.workers.max=$PARALLEL"
fi

ALL_PASSED=true
for ARCH in "${BUILD_ARCHS[@]}"; do
    LOG_FILE="$PROJECT_ROOT/build-${ARCH}.log"
    if [ "$DEV_MODE" = "true" ]; then
        APK_FILE="$BUILD_DIR/app/build/outputs/apk/debug/app-debug.apk"
        GRADLE_TASK="assembleDebug"
    else
        APK_FILE="$BUILD_DIR/app/build/outputs/apk/release/app-release.apk"
        GRADLE_TASK="assembleRelease"
    fi

    echo ""
    echo "[BUILD] === Building $ARCH ==="
    echo "[BUILD] Log: $LOG_FILE | Filter: -PreactNativeArchitectures=$ARCH"

    cd "$BUILD_DIR"

    # Build single arch using assembleRelease (self-contained) or assembleDebug (dev mode)
    ./gradlew "$GRADLE_TASK" --no-daemon \
        -PreactNativeArchitectures="$ARCH" \
        -Dorg.gradle.jvmargs="$JVM_ARGS" \
        2>&1 | stdbuf -oL tee "$LOG_FILE" &
    BUILD_PID=$!

    # Start monitor if --watch
    if [ "$WATCH" = "true" ]; then
        "$SCRIPT_DIR/build-monitor.sh" "$LOG_FILE" "$ARCH" "$BUILD_PID" &
        MONITOR_PID=$!
        echo "[BUILD] Monitor PID: $MONITOR_PID"
    fi

    # Wait for build to finish
    wait $BUILD_PID
    BUILD_EXIT=$?

    # Stop monitor
    if [ "$WATCH" = "true" ] && [ -n "${MONITOR_PID:-}" ]; then
        kill $MONITOR_PID 2>/dev/null || true
        echo ""
    fi

    # Show result
    if [ $BUILD_EXIT -eq 0 ]; then
        echo "[BUILD] SUCCESS: $ARCH -> $APK_FILE"
        
        # Copy APK to arch-specific filename to prevent overwriting
        if [ -f "$APK_FILE" ]; then
            if [ "$DEV_MODE" = "true" ]; then
                ARCH_APK="$PROJECT_ROOT/app-debug-${ARCH}.apk"
            else
                ARCH_APK="$PROJECT_ROOT/app-release-${ARCH}.apk"
            fi
            cp "$APK_FILE" "$ARCH_APK"
            echo "[BUILD] Copied to: $ARCH_APK"
        fi
    else
        echo "[BUILD] FAILED: $ARCH (exit code $BUILD_EXIT)"
        echo "[BUILD] See $LOG_FILE for details"
        tail -20 "$LOG_FILE" || true
        ALL_PASSED=false
        if [ "$DEV_MODE" = "true" ]; then
            exit $BUILD_EXIT
        fi
    fi
done

echo ""

if [ "$ALL_PASSED" = "true" ]; then
    echo "[BUILD] All builds complete!"
else
    echo "[BUILD] Some builds failed (check logs above)"
fi

# Dev mode: install, launch expo server, and open the app
if [ "$DEV_MODE" = "true" ] && [ "$ALL_PASSED" = "true" ]; then
    echo ""
    echo "[BUILD] Dev mode: Installing APK on emulator..."
    APK_FILE="$BUILD_DIR/app/build/outputs/apk/debug/app-debug.apk"
    if [ -f "$APK_FILE" ]; then
        if [ "$CACHE" = "true" ]; then
            export EMULATOR_CACHE=1
        fi
        "$SCRIPT_DIR/android-emulator.sh" start "$AVD_NAME"
        "$SCRIPT_DIR/android-emulator.sh" wait-device 180
        "$SCRIPT_DIR/android-emulator.sh" install "$APK_FILE"
        "$SCRIPT_DIR/android-emulator.sh" launch
        echo ""
        echo "[BUILD] Launching Metro dev server (npx expo start)..."
        echo "[BUILD] The app will connect to this server for live reload."
        echo "[BUILD] Press Ctrl+C to stop the dev server."
        echo ""
        cd "$PROJECT_ROOT"
        npx expo start --host lan --android
    else
        echo "[BUILD] Error: APK not found at $APK_FILE"
        exit 1
    fi
# Self-contained mode: install and launch on emulator (no server needed)
# Only installs if --install flag was passed
elif [ "$ALL_PASSED" = "true" ] && [ "$ARCH_TARGET" != "all" ] && [ "$DO_INSTALL" = "true" ]; then
    echo ""
    echo "[BUILD] Self-contained mode: Installing and launching on emulator..."
    APK_FILE="$BUILD_DIR/app/build/outputs/apk/release/app-release.apk"
    if [ -f "$APK_FILE" ]; then
        if [ "$CACHE" = "true" ]; then
            export EMULATOR_CACHE=1
        fi
        "$SCRIPT_DIR/android-emulator.sh" start "$AVD_NAME"
        "$SCRIPT_DIR/android-emulator.sh" wait-device 180
        "$SCRIPT_DIR/android-emulator.sh" install "$APK_FILE"
        "$SCRIPT_DIR/android-emulator.sh" launch
        echo ""
        echo "[BUILD] App installed and launched (self-contained, no dev server needed)."
    else
        echo "[BUILD] Error: APK not found at $APK_FILE"
        exit 1
    fi
elif [ "$ALL_PASSED" = "true" ] && [ "$ARCH_TARGET" != "all" ]; then
    APK_FILE="$BUILD_DIR/app/build/outputs/apk/release/app-release.apk"
    echo ""
    echo "[BUILD] APK built at: $APK_FILE"
    echo "[BUILD] Run with --install to install on emulator."
fi

echo ""

echo "[BUILD] Done."
