#!/bin/bash
# Interactive Android Build Script
# Builds one arch at a time (sequential) with live monitoring
#
# Usage:
#   ./scripts/build-android.sh                    # Self-contained build, all archs (default)
#   ./scripts/build-android.sh --arch x86_64      # Build a specific arch (self-contained)
#   ./scripts/build-android.sh --dev              # Dev client: x86_64 + expo start + install + launch
#   ./scripts/build-android.sh --dev --watch      # Dev client with live monitor + expo server
#   ./scripts/build-android.sh --parallel N       # Build all with N workers
#
# Modes:
#   (default)  Self-contained release-style APK: the JS bundle is embedded via
#              NODE_ENV=production so the app runs with NO Metro/dev server.
#   --dev      Development client: builds debug APK and launches `npx expo start`
#              (Metro) so the app connects to the dev server for live reload.
#
# Options:
#   --arch all|x86_64|arm64-v8a|armeabi-v7a|x86   Architecture to build (default: all)
#   --dev                                         Dev client mode (x86_64 + expo start + install + launch)
#   --parallel N                                  Workers per arch (default: 1)
#   --force-model                                 Force model regeneration
#   --watch                                       Enable live build monitoring
#   --clean                                       Clean prebuild (expo prebuild --clean)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ANDROID_SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/home/d/Android/Sdk}}"

# Defaults
ARCH_LIST=("arm64-v8a" "armeabi-v7a" "x86" "x86_64")
ARCH_TARGET="all"
PARALLEL=1
FORCE_MODEL=false
WATCH=false
CLEAN=false
DEV_MODE=false

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
        --parallel)
            PARALLEL="$2"
            shift 2
            ;;
        --force-model)
            FORCE_MODEL=true
            shift
            ;;
        --watch)
            WATCH=true
            shift
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        *)
            echo "[BUILD] Unknown option: $1"
            exit 1
            ;;
    esac
done

export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
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
EXPORT_DIR="$PROJECT_ROOT/.expo-export-tmp"
if [ "$DEV_MODE" = "true" ]; then
    echo "[BUILD] Dev client mode: bundle will connect to Metro (npx expo start)"
    unset NODE_ENV
else
    echo "[BUILD] Self-contained mode: embedding JS bundle (NODE_ENV=production)"
    export NODE_ENV=production
fi

# Step 1: Model generation
echo ""
echo "[BUILD] Step 1: Model Generation"
if [ "$FORCE_MODEL" = "true" ]; then
    echo "[BUILD] Forcing model regeneration..."
    node "$SCRIPT_DIR/generate-model.js" --force
else
    echo "[BUILD] Checking model..."
    node "$SCRIPT_DIR/generate-model.js"
fi

# Step 2: Prebuild Android project
echo ""
echo "[BUILD] Step 2: Expo Prebuild (Android)"
if [ "$CLEAN" = "true" ]; then
    npx expo prebuild --clean --platform android
else
    npx expo prebuild --platform android
fi

# Define BUILD_DIR early so Step 2b can use it
BUILD_DIR="$PROJECT_ROOT/android"

# Step 2b: For self-contained builds, explicitly export the JS bundle and copy
# it (plus assets) into the Android assets folder so the APK is fully standalone
# and does NOT need a Metro/dev server. The React Gradle Plugin's export:embed
# step is unreliable for assembleDebug, so we do it explicitly here.
if [ "$DEV_MODE" = "false" ]; then
    echo ""
    echo "[BUILD] Step 2b: Exporting JS bundle (self-contained)..."
    rm -rf "$EXPORT_DIR"
    NODE_ENV=production npx expo export --platform android --output-dir "$EXPORT_DIR" 2>&1 | tail -8

    # Locate the exported Hermes bytecode bundle
    BUNDLE_SRC=$(find "$EXPORT_DIR/_expo/static/js/android" -name '*.hbc' 2>/dev/null | head -1)
    if [ -z "$BUNDLE_SRC" ]; then
        BUNDLE_SRC=$(find "$EXPORT_DIR" -name 'index.android.bundle' 2>/dev/null | head -1)
    fi

    if [ -z "$BUNDLE_SRC" ]; then
        echo "[BUILD] ERROR: expo export did not produce a JS bundle"
        exit 1
    fi

    ASSETS_DEST="$BUILD_DIR/app/src/main/assets"
    mkdir -p "$ASSETS_DEST"
    cp "$BUNDLE_SRC" "$ASSETS_DEST/index.android.bundle"
    # Copy exported static assets (fonts, images) if present
    if [ -d "$EXPORT_DIR/assets" ]; then
        cp -r "$EXPORT_DIR/assets/." "$ASSETS_DEST/" 2>/dev/null || true
    fi
    echo "[BUILD] Bundle copied to $ASSETS_DEST/index.android.bundle ($(du -h "$ASSETS_DEST/index.android.bundle" | cut -f1))"
fi

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
    APK_FILE="$BUILD_DIR/app/build/outputs/apk/debug/app-debug.apk"

    echo ""
    echo "[BUILD] === Building $ARCH ==="
    echo "[BUILD] Log: $LOG_FILE | Filter: -PreactNativeArchitectures=$ARCH"

    cd "$BUILD_DIR"

    # Build single arch using assembleDebug with arch filter
    ./gradlew assembleDebug --no-daemon \
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
        # Ensure the emulator is running before installing (no-op if already up)
        "$SCRIPT_DIR/android-emulator.sh" start
        "$SCRIPT_DIR/android-emulator.sh" install "$APK_FILE"
        "$SCRIPT_DIR/android-emulator.sh" launch
        echo ""
        echo "[BUILD] Launching Metro dev server (npx expo start)..."
        echo "[BUILD] The app will connect to this server for live reload."
        echo "[BUILD] Press Ctrl+C to stop the dev server."
        echo ""
        # Start Metro in the foreground so the user can use live reload.
        # The app connects to this server (dev client mode).
        cd "$PROJECT_ROOT"
        npx expo start --host lan --android
    else
        echo "[BUILD] Error: APK not found at $APK_FILE"
        exit 1
    fi
# Self-contained mode: install and launch on emulator (no server needed)
elif [ "$ALL_PASSED" = "true" ] && [ "$ARCH_TARGET" != "all" ]; then
    echo ""
    echo "[BUILD] Self-contained mode: Installing and launching on emulator..."
    APK_FILE="$BUILD_DIR/app/build/outputs/apk/debug/app-debug.apk"
    if [ -f "$APK_FILE" ]; then
        "$SCRIPT_DIR/android-emulator.sh" install "$APK_FILE"
        "$SCRIPT_DIR/android-emulator.sh" launch
        echo ""
        echo "[BUILD] App installed and launched (self-contained, no dev server needed)."
    else
        echo "[BUILD] Error: APK not found at $APK_FILE"
        exit 1
    fi
fi

echo ""
echo "[BUILD] Done."