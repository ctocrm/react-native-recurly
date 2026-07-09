# AI Icon Upscaling Implementation

## Problem Statement

Two issues were reported:

1. "The clear white BG **spin forever**" - White background removal process was hanging/crashing
2. "The Upscale(AI) finish but the icon looks unchanged" - AI upscaling completed but produced no visual change

## Root Causes Identified

### Issue 1: White Background Removal Stack Overflow

- **Location**: `src/services/whiteBgRemoval.ts`
- **Cause**: `btoa(String.fromCharCode(...largeArray))` spread large Uint8Array into function arguments, exceeding call stack limit
- **Symptom**: "Maximum call stack size exceeded" crash/hang

### Issue 2: AI Upscaling Model Was Placeholder

- **Location**: `assets/models/espcn_2x.tflite`
- **Cause**: Model file was 14 bytes (placeholder text) instead of a real TensorFlow Lite model
- **Symptom**: Model couldn't actually process images, output was unchanged

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
/tmp/tfenv/bin/python scripts/train_espcn_fast.py
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
      eas: {
        projectId: "a5994d10-17c0-4d53-82bc-9fac030b1ead",
      },
    },
  },
  plugins: ["react-native-fast-tflite"],
};
```

### 5. EAS Build Profile (`eas.json`)

```json
{
  "cli": { "version": ">= 3.0.0" },
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "gradleCommand": ":app:assembleDebug" }
    }
  }
}
```

### 6. Inference Code Fix (`src/services/iconProcessing.ts`)

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

## Build Process

### Prerequisites

- `react-native-fast-tflite` already in `package.json`
- Android SDK/NDK installed
- EAS CLI installed (`npm install -g eas-cli`)

### Steps to Build

```bash
# 1. Initialize EAS (if not already done)
npx eas init --force

# 2. Run local build
npx eas build --profile preview --platform android --local

# Or use Expo CLI prebuild + Gradle directly
npx expo prebuild --clean
cd android && ./gradlew assembleDebug
```

### Testing

- The app will show `[ICON_AI] RNTflite native module not available` in Expo Go
- This is expected - Expo Go doesn't support custom native modules
- Install the development build to test AI upscaling

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

## Files Modified

- `assets/models/espcn_2x.tflite` - Generated TFLite model (11KB)
- `eas.json` - Added preview build profile
- `metro.config.js` - Added tflite asset extension
- `app.config.js` - Added owner, android package, projectId, plugin
- `src/services/iconProcessing.ts` - Fixed inference pipeline
- `src/services/whiteBgRemoval.ts` - Fixed chunked btoa conversion
