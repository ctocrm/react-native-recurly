# AI Icon Upscaling Implementation

## Overview

The AI upscaling system uses ESPCN (Efficient Sub-Pixel Convolutional Neural Network) models for edge-AI image upscaling. The implementation now supports **multiple models** optimized for different input/output resolution combinations.

---

## Multi-Model Strategy

### Why Multiple Models?

1. **Resolution Preservation**: Each input resolution gets processed optimally without destructive resizing
2. **Scale-Specific Training**: Models learn best at their specific upscale ratios
3. **Device Pixel Density Aware**: Output size adapts to device DPI for crisp rendering

### Model Matrix

| Input Size | Output Sizes (Scale)                                                      | Models |
| ---------- | ------------------------------------------------------------------------- | ------ |
| 16px       | 64px (4x), 128px (8x), 192px (12x), 256px (16x), 384px (24x), 512px (32x) | 6      |
| 32px       | 64px (2x), 128px (4x), 192px (6x), 256px (8x), 384px (12x), 512px (16x)   | 6      |
| 48px       | 96px (2x), 144px (3x), 192px (4x), 240px (5x), 384px (8x), 576px (12x)    | 6      |
| 64px       | 128px (2x), 192px (3x), 256px (4x), 384px (6x), 512px (8x)                | 5      |
| 96px       | 96px (1x), 192px (2x), 288px (3x), 384px (4x), 480px (5x)                 | 5      |
| 128px      | 128px (1x), 256px (2x), 384px (3x), 512px (4x)                            | 4      |
| 192px      | 192px (1x), 384px (2x), 576px (3x)                                        | 3      |
| 256px      | 256px (1x), 512px (2x)                                                    | 2      |

**Total: 37 models** (~740KB total with optimizations)

### Epoch Optimization

Training epochs are optimized per scale ratio:

- **1-2x scale**: 25-35 epochs (fast convergence)
- **3-4x scale**: 40-60 epochs
- **5-8x scale**: 70-80 epochs
- **12x-16x scale**: 100-120 epochs
- **24x-32x scale**: 130-150 epochs (maximum detail hallucination)

---

## Implementation Details

### 1. Training Script (`scripts/train_espcn_multi.py`)

- Generates all 37 models with appropriate epochs
- Attempts to fetch real icons from Simple Icons CDN
- Falls back to synthetic shapes if real icons unavailable
- Uses TensorFlow Lite optimizations for size

### 2. Model Registry (`src/services/iconProcessing.ts`)

```typescript
const MODEL_REGISTRY: Record<number, Record<number, string>> = {
  16: { 4: "espcn_16x_64x.tflite", 8: "espcn_16x_128x.tflite", ... },
  32: { 2: "espcn_32x_64x.tflite", 4: "espcn_32x_128x.tflite", ... },
  // ... etc
};
```

### 3. Device Pixel Density Detection

```typescript
export function getTargetOutputSize(): number {
  const pixelRatio = PixelRatio.get();
  // Target = 64px * pixelRatio (clamped to 64-512)
  return Math.min(Math.max(Math.round(64 * pixelRatio), 64), 512);
}
```

### 4. Runtime Model Selection

```typescript
// Select model based on input size and target output
const modelInfo = getModelForUpscale(inputSize, targetOutputSize);
// Returns { inputSize, scale, modelFile, outputSize }
```

---

## Build Commands

```bash
# Generate all models
npm run generate-model:multi

# Force regeneration
npm run generate-model:multi:force

# Build with models
npm run build:android
npm run build:android:force  # Includes model regeneration
```

---

## Model Architecture (ESPCN)

```
Input:  (None, None, 3)    - Flexible input, 3 channels
  │
  ├─ Conv2D(16, 3x3, padding=same, activation=relu)
  ├─ Conv2D(scale² × 3, 3x3, padding=same)
  ├─ Lambda(depth_to_space, scale=N)  - Pixel shuffle
  └─ Conv2D(3, 3x3, padding=same, activation=sigmoid)
Output: (None, None, 3)    - N-times upscaled image
```

---

## Files Modified

- `scripts/train_espcn_multi.py` - New multi-model training script
- `scripts/generate-model.js` - Updated to support multi-model generation
- `src/services/iconProcessing.ts` - Dynamic model selection logic
- `requirements.txt` - Added cairosvg and pillow for real icon processing
- `package.json` - Added `generate-model:multi` scripts

---

## Testing

- Use native builds to test AI upscaling (Expo Go doesn't support native modules)
- Run: `./scripts/verify-android.sh`
- Check logs: `./scripts/android-emulator.sh logcat`
