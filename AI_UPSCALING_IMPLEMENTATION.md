# AI Icon Upscaling Implementation

## Problem Statement

Two issues were reported:

1. "The clear white BG **spin forever**" - White background removal process was hanging/crashing
2. "The Upscale(AI) finish but the icon looks unchanged" - AI upscaling completed but produced no visual change

---

## Root Causes Identified

### Issue 1: White Background Removal Stack Overflow

- **Location**: `src/services/whiteBgRemoval.ts`
- **Cause**: `btoa(String.fromCharCode(...largeArray))` spread large Uint8Array into function arguments, exceeding call stack limit
- **Symptom**: "Maximum call stack size exceeded" crash/hang

### Issue 2: AI Upscaling Model Was Placeholder

- **Location**: `assets/models/espcn_2x.tflite`
- **Cause**: Model file was 14 bytes (placeholder text) instead of a real TensorFlow Lite model
- **Symptom**: Model couldn't actually process images, output was unchanged

---

## Fixes Applied

### 1. White Background Removal Fix (`src/services/whiteBgRemoval.ts`)

```typescript
// Before (line 151):
outB64 = btoa(outB64);

// After (lines 144-150):
// Chunk the conversion to avoid "Maximum call stack size exceeded"
const uint8 = new Uint8Array(pngData);
let outB64 = "";
const chunkSize = 8192;
for (let i = 0; i < uint8.length; i += chunkSize) {
  outB64 += String.fromCharCode(...uint8.subarray(i, end));
}
outB64 = btoa(outB64);
```

### 2. Model Training Script (`scripts/train_espcn_fast.py`)

Created a minimal ESPCN (Enhanced Super-Resolution Generative Adversarial Networks) model:

- Input: 32x32 RGB image
- Output: 64x64 RGB image (2x upscale)
- Architecture: Conv2D -> PixelShuffle -> Conv2D
- Training: 12 epochs on synthetic icon-like data
- Result: 11,880 byte TFLite model

To retrain the model:

```bash
npm run generate-model:force
```

### 3. Metro Bundler Configuration (`metro.config.js`)

```javascript
// Added tflite to asset extensions
config.resolver.assetExts = [...config.resolver.assetExts, "tflite"];
```

### 4. Expo Configuration (`app.config.js`)

```javascript
module.exports = {
  expo: {
    owner: "ctocrm",
    android: {
      package: "com.ctocrm.jsmastery",
    },
    extra: {
      posthogProjectToken: process.env.POSTHOG_PROJECT_TOKEN,
      posthogHost: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    },
  },
  plugins: ["react-native-fast-tflite"],
};
```

### 5. Inference Code Fix (`src/services/iconProcessing.ts`)

- Fixed API call from `loadTfliteModel` to `loadTensorflowModel`
- Proper input processing:
  - Resize to 32x32 using expo-image-manipulator
  - Decode PNG with UPNG to get RGBA pixels
  - Extract RGB channels, normalize to float32 [0,1]
  - Feed to model tensor
- Proper output processing:
  - Model outputs float32 [0,1] values
  - Convert to uint8 [0,255] for PNG encoding
  - Re-chunk btoa to prevent stack overflow

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

## Native Build Process (EAS-free)

This project uses native Android/iOS builds instead of EAS. See `BUILD.md` for complete instructions.

### Prerequisites

- `react-native-fast-tflite` in `package.json`
- Android SDK installed and `$ANDROID_HOME` set
- Java JDK 17+ installed
- For iOS builds: macOS with Xcode

### Steps to Build

```bash
# Generate model (only if needed)
npm run generate-model

# Full native Android build (model generation included)
npm run build:android

# Or run the verification script (builds, installs, launches on emulator)
./scripts/verify-android.sh

# Force model regeneration
npm run build:android:force
./scripts/verify-android.sh --force-model
```

### Build Commands Reference

| Command                                       | Description                               |
| --------------------------------------------- | ----------------------------------------- |
| `npm run generate-model`                      | Generate TFLite model if needed           |
| `npm run generate-model:force`                | Force model regeneration                  |
| `npm run prebuild:android`                    | Generate native Android project           |
| `npm run build:android`                       | Build debug APK with model                |
| `./scripts/verify-android.sh`                 | Full build + install + launch on emulator |
| `./scripts/android-emulator.sh start`         | Start the emulator                        |
| `./scripts/android-emulator.sh install <apk>` | Install APK to emulator                   |
| `./scripts/android-emulator.sh launch`        | Launch the app                            |
| `./scripts/android-emulator.sh logcat`        | Monitor logs                              |

### Testing

- The app will show `[ICON_AI] RNTflite native module not available` in Expo Go
- This is expected - Expo Go doesn't support custom native modules
- Use native builds to test AI upscaling: `./scripts/verify-android.sh`

---

## Model Architecture Details

```
Input:  (None, None, None, 3)  - Flexible input size, 3 channels
  │
  ├─ Conv2D(16, 3x3, padding=same, activation=relu)
  ├─ Conv2D(12, 3x3, padding=same)          - 12 = scale² × 3
  ├─ Lambda(depth_to_space, scale=2)        - Pixel shuffle
  └─ Conv2D(3, 3x3, padding=same, activation=sigmoid)
Output: (None, None, None, 3)  - 2x upscaled image
```

---

## Files Modified

- `assets/models/espcn_2x.tflite` - Generated TFLite model (11KB)
- `metro.config.js` - Added tflite asset extension
- `app.config.js` - Added owner, android package, plugin (removed EAS config)
- `src/services/iconProcessing.ts` - Fixed inference pipeline
- `src/services/whiteBgRemoval.ts` - Fixed chunked btoa conversion

---

## New Files Added

- `scripts/generate-model.js` - Model generation wrapper with --force option
- `scripts/android-emulator.sh` - Emulator management script
- `scripts/build-android.sh` - Native Android build script
- `scripts/verify-android.sh` - Build verification script
- `scripts/prebuild-ios.sh` - iOS prebuild script (macOS)
- `BUILD.md` - Detailed build instructions

