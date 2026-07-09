#!/bin/bash
# Native Android build script with model generation
# Usage: ./scripts/build-android.sh [--force-model]
#
# Options:
#   --force-model    Force model regeneration even if model exists and is fresh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ANDROID_SDK="${ANDROID_HOME:-/home/d/Android/Sdk}"

FORCE_MODEL="false"
if [ "$1" = "--force-model" ]; then
    FORCE_MODEL="true"
fi

echo "=========================================="
echo "Native Android Build Script"
echo "=========================================="

# Set Java 17 for react-native-fast-tflite compatibility
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH="$JAVA_HOME/bin:$PATH"
echo "[BUILD] Using Java: $JAVA_HOME"

# Step 1: Generate model (if needed or forced)
echo ""
echo "[BUILD] Step 1: Model Generation"
cd "$PROJECT_ROOT"
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
npx expo prebuild --clean --platform android

# Step 3: Build Debug APK
echo ""
echo "[BUILD] Step 3: Building Debug APK"
cd "$PROJECT_ROOT/android"

# Disable new architecture for react-native-fast-tflite compatibility
# The library has toolchain issues with new architecture
sed -i 's/newArchEnabled=true/newArchEnabled=false/' gradle.properties

# Use gradlew wrapper (it will download Gradle if needed)
./gradlew assembleDebug --no-daemon

APK_PATH="$PROJECT_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

if [ -f "$APK_PATH" ]; then
    echo "[BUILD] APK built successfully: $APK_PATH"
    ls -la "$APK_PATH"
else
    echo "[BUILD] Error: APK not found at $APK_PATH"
    exit 1
fi

echo ""
echo "[BUILD] Build complete!"
echo ""
echo "To install and run on emulator, use:"
echo "  $SCRIPT_DIR/android-emulator.sh install $APK_PATH"
echo "  $SCRIPT_DIR/android-emulator.sh launch"