# Native Build Guide

This document provides detailed instructions for building the app natively without EAS.

## Overview

This project uses `react-native-fast-tflite` for on-device AI icon upscaling. Since Expo Go doesn't support custom native modules, we use native development builds.

---

## Android Build Process

### Prerequisites

1. **Android SDK** - Must be installed and configured:
   - `ANDROID_HOME` environment variable (default: `/home/d/Android/Sdk`)
   - Platform SDK 34+ installed
   - Android SDK Build-Tools 34+ installed
   - Android emulator system image installed

2. **Java JDK** - Version 17 or higher

3. **AVD (Android Virtual Device)** - Configured emulator:
   - Default AVD name: `Pixel_6a`
   - Can be created via Android Studio AVD Manager

### Quick Start

```bash
# Run full build and verification (builds, installs, launches)
./scripts/verify-android.sh

# Force model regeneration and run
./scripts/verify-android.sh --force-model
```

### Step-by-Step Build

#### Step 1: Generate the AI Model

```bash
# Check if model needs regeneration (fast)
npm run generate-model

# Or force regeneration (required if train_espcn_fast.py changed)
npm run generate-model:force
```

The model is output to `assets/models/espcn_2x.tflite`.

#### Step 2: Prebuild the Android Project

```bash
npm run prebuild:android
```

This generates/updates the native Android project with:

- All Expo plugins (including `react-native-fast-tflite`)
- Native module linking
- Asset bundling configuration

#### Step 3: Build the APK

```bash
# Using npm script
npm run build:android

# Or manually
cd android
./gradlew assembleDebug --no-daemon
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

#### Step 4: Start Emulator and Install

```bash
# Start emulator (waits for full boot)
./scripts/android-emulator.sh start

# Install the APK
./scripts/android-emulator.sh install /path/to/app-debug.apk

# Launch the app
./scripts/android-emulator.sh launch
```

#### Step 5: Verify TFLite Integration

```bash
# Monitor logs for AI module initialization
./scripts/android-emulator.sh logcat

# Look for this message:
# [ICON_AI] super-resolution model loaded
```

### Build Commands Reference

| Command                                       | Description                     |
| --------------------------------------------- | ------------------------------- |
| `npm run generate-model`                      | Generate TFLite model if needed |
| `npm run generate-model:force`                | Force model regeneration        |
| `npm run prebuild:android`                    | Generate native Android project |
| `npm run build:android`                       | Build debug APK with model      |
| `./scripts/verify-android.sh`                 | Full build + install + launch   |
| `./scripts/android-emulator.sh start`         | Start the emulator              |
| `./scripts/android-emulator.sh install <apk>` | Install APK to emulator         |
| `./scripts/android-emulator.sh launch`        | Launch the app                  |
| `./scripts/android-emulator.sh logcat`        | Monitor app logs                |
| `./scripts/android-emulator.sh status`        | Check emulator status           |

---

## iOS Build Process (macOS Only)

### Prerequisites

- macOS with Xcode 15+ installed
- CocoaPods (`sudo gem install cocoapods` or via Homebrew)
- iOS Simulator or physical device
- Apple Developer account (for device testing)

### Steps

```bash
# Generate the native iOS project
npm run prebuild:ios

# Then on macOS:
cd ios
bundle install  # Install fastlane if using
bundle exec pod install --repo-update

# Open in Xcode or build via command line:
# xcodebuild -workspace Jsmastery.xcworkspace -scheme Jsmastery -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 15'
```

---

## Build Configuration Fixes Applied

### Java Toolchain Requirements

The `react-native-fast-tflite` library requires Java 17 for compilation:

```bash
# All build scripts explicitly set JAVA_HOME:
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
```

The Gradle wrapper uses Java 17 automatically via `org.gradle.java.home` in gradle.properties.

### New Architecture Enablement

React Native New Architecture is **required** for `react-native-worklets` and `react-native-reanimated`:

```properties
# android/gradle.properties
newArchEnabled=true
```

The build will fail with error:

```
[Worklets] Worklets require new architecture to be enabled.
```

### EAS Build Removal

EAS build configuration was removed:

- Deleted `eas.json`
- Removed build profiles from `app.config.js`
- Kept only the `react-native-fast-tflite` plugin:

```javascript
plugins: ["react-native-fast-tflite"];
```

### Native Build Scripts Created

| Script                        | Purpose                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `scripts/generate-model.js`   | Model generation with `--force` optional switch         |
| `scripts/build-android.sh`    | Native Android build with integrated model generation   |
| `scripts/prebuild-ios.sh`     | iOS prebuild for macOS environments                     |
| `scripts/verify-android.sh`   | Full verification: build + install + launch on emulator |
| `scripts/android-emulator.sh` | Emulator management (start/stop/install/launch/logcat)  |

---

## Model Architecture

The ESPCN 2x model architecture:

```
Input:  32x32 RGB image
  │
  ├─ Conv2D(16, 3x3, padding=same, activation=relu)
  ├─ Conv2D(12, 3x3, padding=same)           # 12 = scale² × 3
  ├─ Lambda(depth_to_space, scale=2)          # Pixel shuffle
  └─ Conv2D(3, 3x3, padding=same, activation=sigmoid)
Output: 64x64 RGB image
```

---

## Troubleshooting

### Emulator Not Starting

```bash
# Check if AVD exists
/home/d/Android/Sdk/emulator/emulator -list-avds

# Create AVD if needed (requires Android Studio UI or avdmanager)
```

### TFLite Module Not Loading

If you see `[ICON_AI] RNTflite native module not available`:

- Ensure you're running a native build, not Expo Go
- Check the APK was installed correctly
- Verify `react-native-fast-tflite` is in `app.config.js` plugins

### Slow Build Performance

- Building in a VM is inherently slow - extend timeouts
- Use `--no-daemon` flag to avoid Gradle daemon issues in CI
- Model generation requires Python with TensorFlow installed

### Python Environment Issues

The model training script requires TensorFlow:

- Uses `/tmp/tfenv/bin/python` if available
- Falls back to `python3` with `tensorflow` package
- Create a virtual environment: `python3 -m venv .venv && pip install tensorflow numpy`

