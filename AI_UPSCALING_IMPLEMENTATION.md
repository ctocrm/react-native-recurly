# AI Icon Upscaling Implementation

## Overview

The AI upscaling system uses **two families** of edge-AI super-resolution models:

- **Fast**: small ESPCN models (lightweight, fast inference, acceptable quality).
- **Sharp**: FSRCNN models trained with a combined MAE + MS-SSIM + VGG perceptual loss (better edges and detail, slightly larger and slower).

Both families are organized as **multiple models** optimized for different input/output resolution combinations. The app selects the right model at runtime based on the icon's input size, the device's pixel density, and the user's chosen quality mode.

---

## Multi-Model Strategy

### Why Multiple Models?

1. **Resolution Preservation**: Each input resolution gets processed optimally without destructive resizing.
2. **Scale-Specific Training**: Models learn best at their specific upscale ratios.
3. **Device Pixel Density Aware**: Output size adapts to device DPI for crisp rendering.
4. **Quality vs. Speed Choice**: Users can pick "Fast" or "Sharp" depending on their preference.

### Model Matrix

| Input Size | Output Sizes (Scale)                                                      | Models |
| ---------- | ------------------------------------------------------------------------- | ------ |
| 16px       | 64px (4x), 128px (8x), 192px (12x), 256px (16x), 384px (24x), 512px (32x) | 6      |
| 32px       | 64px (2x), 128px (4x), 192px (6x), 256px (8x), 384px (12x), 512px (16x)   | 6      |
| 48px       | 96px (2x), 144px (3x), 192px (4x), 240px (5x), 384px (8x), 576px (12x)    | 6      |
| 64px       | 128px (2x), 192px (3x), 256px (4x), 384px (6x), 512px (8x)                | 5      |
| 96px       | 192px (2x), 288px (3x), 384px (4x), 480px (5x)                            | 4      |
| 128px      | 256px (2x), 384px (3x)                                                    | 2      |

> **1x scales excluded**: `tf.nn.depth_to_space` cannot infer an output shape for
> scale=1, so the 96px/128px "1x" passthrough models are not part of the matrix.
> The `128px → 512px` (4x) ESPCN model also failed to generate and is currently
> omitted, so the 128px input tops out at 384px.

**Fast ESPCN matrix currently bundled: 29 models (~1.9 MB).**

### Current Bundle Status

- **Fast (ESPCN)**: bundled and active (29 models in `assets/models/`).
- **Sharp (FSRCNN)**: **not generated / not bundled yet.** The `MODEL_REGISTRY`
  still describes the sharp matrix for the future, but no `fsrcnn_*.tflite`
  files are `require`d in `MODEL_MAP`. Until they are, `isQualityAvailable("sharp")`
  returns `false`: the picker defaults to (and locks onto) Fast, and any request
  for Sharp transparently degrades **sharp → fast → bilinear**.

> **Build safety (automatic)**: `MODEL_MAP` is **auto-generated** from the
> `*.tflite` files that physically exist in `assets/models/` by
> `scripts/generate-model-map.js`, which writes `src/services/generatedModelMap.ts`.
> The codegen runs automatically during the build (Step 1 of
> `scripts/build-android.sh`, right after model generation) and can be run
> manually with `npm run generate-model-map`. Because the `require()` list is
> derived from a directory scan, it can never point at a missing file — so the
> build **never fails on absent models**, and any newly generated model (e.g. the
> sharp FSRCNN family) is bundled automatically on the next build with **no
> hand-editing**. Just generate the models and rebuild; `--force-model` will train
> them first and then regenerate the map in the same run.

### Epoch Optimization

**Fast (ESPCN)**

- **1-2x scale**: 25-35 epochs
- **3-4x scale**: 40-70 epochs
- **5-8x scale**: 80-100 epochs
- **12x-32x scale**: 100-150 epochs

**Sharp (FSRCNN)**

- **1-2x scale**: 40-80 epochs
- **3-4x scale**: 100-120 epochs
- **5-8x scale**: 140-160 epochs
- **12x-32x scale**: 180-250 epochs

The sharp models train longer because the combined loss (MAE + MS-SSIM + perceptual) needs more iterations to converge.

---

## Implementation Details

### 1. Training Scripts

- `scripts/train_espcn_multi.py` — Fast ESPCN family.
- `scripts/train_fsrcnn_multi.py` — Sharp FSRCNN family with combined loss.

Both scripts:

- Generate all models for the matrix above.
- Fetch real icons from Simple Icons / Tabler CDNs when possible.
- Fall back to synthetic shapes if real icons are unavailable.
- Apply data augmentation (flip, rotation, brightness) for the sharp family.
- Use TensorFlow Lite `Optimize.DEFAULT` quantization for size.
- Support `--force` and `--model=input_output` flags.

### 2. Model Registry (`src/services/iconProcessing.ts`)

```typescript
const MODEL_REGISTRY: Record<
  UpscaleQuality,
  Record<number, Record<number, string>>
> = {
  fast: {
    16: { 4: "espcn_16x_64x.tflite", 8: "espcn_16x_128x.tflite", ... },
    // ...
  },
  sharp: {
    16: { 4: "fsrcnn_16x_64x.tflite", 8: "fsrcnn_16x_128x.tflite", ... },
    // ...
  },
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
// Select model based on input size, target output, and quality mode
const modelInfo = getModelForUpscale(inputSize, targetOutputSize, "sharp");
// Returns { inputSize, scale, modelFile, outputSize }
```

### 5. Quality Mode UI

The icon picker modal (`src/components/SubscriptionIconPickerModal.tsx`) now includes an "AI Upscale Quality" toggle:

- **Sharp** (default): FSRCNN models, best visual quality.
- **Fast**: ESPCN models, fastest inference.

The selected mode is passed to `upscaleIconAi(..., quality)` and is also a good candidate for PostHog analytics.

---

## Build Commands

```bash
# Generate sharp models (default)
npm run generate-model:multi

# Force regeneration of sharp models
npm run generate-model:multi:force

# Generate fast models
npm run generate-model:multi:fast

# Force regeneration of fast models
npm run generate-model:multi:fast:force

# Train a single model (example: sharp 32->128)
node scripts/generate-model.js --model=32_128

# Build with models
npm run build:android
npm run build:android:force  # Includes model regeneration
```

---

## Model Architectures

### Fast — ESPCN

```
Input:  (None, None, 3)    - Flexible input, 3 channels
  │
  ├─ Conv2D(16, 3x3, padding=same, activation=relu)
  ├─ Conv2D(scale² × 3, 3x3, padding=same)
  ├─ Lambda(depth_to_space, scale=N)  - Pixel shuffle
  └─ Conv2D(3, 3x3, padding=same, activation=sigmoid)
Output: (None, None, 3)    - N-times upscaled image
```

### Sharp — FSRCNN

```
Input:  (None, None, 3)
  │
  ├─ Conv2D(32, 5x5, padding=same, activation=relu)
  ├─ Conv2D(8, 1x1, padding=same, activation=relu)
  ├─ Conv2D(8, 3x3, padding=same, activation=relu) × 3
  ├─ Conv2D(32, 1x1, padding=same, activation=relu)
  ├─ Conv2D(scale² × 3, 5x5, padding=same)
  ├─ Lambda(depth_to_space, scale=N)
  └─ Conv2D(3, 5x5, padding=same, activation=sigmoid)
Output: (None, None, 3)
```

### Loss Function (Sharp)

```python
def combined_loss(y_true, y_pred):
    mae = tf.reduce_mean(tf.abs(y_true - y_pred))
    ssim = ssim_term(y_true, y_pred)            # (MS-)SSIM, scale-adaptive
    perceptual = perceptual_loss(y_true, y_pred)  # VGG19 blocks 1-3
    return mae + 0.15 * ssim + 0.05 * perceptual
```

> **Scale-adaptive SSIM**: `tf.image.ssim_multiscale` always downsamples through
> 5 scales, which shrinks a 64px output to 4px — smaller than the 7px Gaussian
> window — and crashes training. `make_combined_loss(output_size)` therefore
> picks the number of MS-SSIM scales that fit (`output >= filter_size * 2**(n-1)`)
> and falls back to single-scale SSIM for very small outputs.
>
> **NaN safety**: the VGG perceptual term is large-magnitude, so training uses
> `Adam(learning_rate=1e-4, clipnorm=1.0)` to keep the combined loss from
> diverging to NaN.

---

## Files Modified / Added

- `scripts/train_espcn_multi.py` — Fast ESPCN multi-model training.
- `scripts/train_fsrcnn_multi.py` — Sharp FSRCNN multi-model training.
- `scripts/generate-model.js` — Quality-aware wrapper with `--quality=fast|sharp`.
- `scripts/generate-model-map.js` — Codegen that builds the static `require()` map from the files present in `assets/models/`.
- `src/services/generatedModelMap.ts` — Auto-generated `MODEL_MAP` (do not edit by hand).
- `src/services/iconProcessing.ts` — Quality-aware model registry and selection; imports the generated `MODEL_MAP`.
- `scripts/build-android.sh` — Runs the model-map codegen after model generation.

- `src/components/SubscriptionIconPickerModal.tsx` — Quality toggle UI.
- `package.json` — Updated model generation scripts.
- `requirements.txt` — Already includes `cairosvg` and `pillow`.
- `eslint.config.js` — Ignores `scripts/*` to avoid `__dirname` lint errors.

---

## Testing

- Use native builds to test AI upscaling (Expo Go doesn't support custom native modules).
- Run: `./scripts/verify-android.sh`
- Check logs: `./scripts/android-emulator.sh logcat`
- Look for `[ICON_AI]` log lines to confirm which model was loaded and used.

---

## Notes

- The old single `espcn_2x.tflite` model is no longer used by the picker; it is kept only for backward compatibility during the transition.
- Real-ESRGAN was evaluated and removed: the models are ~65 MB each and too slow for CPU inference on mobile devices.
- If bundle size becomes a concern, you can drop the `fast` family and ship only `sharp`, or prune the matrix to the most common input/output pairs.
