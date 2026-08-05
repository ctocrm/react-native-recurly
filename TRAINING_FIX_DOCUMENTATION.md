# AI Icon Upscaling Training Fix Documentation

**Date**: 2026-04-08  
**Status**: All code fixes complete, ready for GPU training run  
**Models**: 70 total (35 ESPCN "fast" + 35 FSRCNN "sharp")

---

## Executive Summary

The training pipeline was producing **garbage quality models** (constant-gray output that failed to beat bicubic interpolation). The environment setup (CUDA, TensorFlow, Python) was already correct. The problem was entirely in the **training logic**: loss functions, data pipeline, epochs, and validation.

**Root cause**: ESPCN used MAE-only loss with synthetic circle/rectangle data, no perceptual guidance, insufficient epochs for large scales, and validation that only checked variance (not quality vs baseline).

---

## What Was Broken (The "Fiasco")

### 1. ESPCN Loss Function — MAE Only

```python
# BEFORE (train_espcn_multi.py line 243)
model.compile(optimizer="adam", loss="mae")
```

- No perceptual loss (VGG features)
- No structural similarity (SSIM/MS-SSIM)
- MAE alone produces blurry, over-smoothed results

### 2. Training Data Pipeline — Silent Synthetic Fallback

```python
# BEFORE: cairosvg import failure → silent fallback to circles/rectangles
try:
    import cairosvg
    # ... rasterize SVG
except ImportError:
    return None  # → synthetic circles/rectangles
```

- **50% target real icons**, but silent fallback meant often 0% real
- Synthetic data: random circles/rectangles — **nothing like app icons**
- No verification of downloaded SVGs (empty/truncated files accepted)

### 3. Epochs Grossly Insufficient for Large Scales

| Scale        | ESPCN Epochs | FSRCNN Epochs | Needed  |
| ------------ | ------------ | ------------- | ------- |
| 8x (64→512)  | 100          | 160           | **250** |
| 6x (64→384)  | 80           | 140           | **200** |
| 4x (64→256)  | 70           | 120           | **150** |
| 2x (256→512) | 150          | 150           | **200** |

### 4. Validation Only Checked Variance (Not Quality)

```python
# BEFORE: Only caught constant-gray, not "worse than bicubic"
if variance < 0.001:
    raise RuntimeError("constant gray")
# No comparison to bicubic baseline!
```

### 5. Batch Size Too Large for Perceptual Loss Stability

- ESPCN: `batch_size = 32 * replicas` → gradient instability with perceptual loss
- FSRCNN: `batch_size = 16 * replicas` (better but still high)

### 6. No Self-Healing in generate-model.js

- Failed fast if `.venv` missing instead of auto-running `train-setup.sh`

---

## Fixes Applied

### 1. ESPCN: Perceptual + MS-SSIM Loss (from FSRCNN)

**File**: `scripts/train_espcn_multi.py`

```python
# AFTER: Combined loss matching FSRCNN architecture
optimizer = keras.optimizers.Adam(learning_rate=1e-4, clipnorm=1.0)
model.compile(
    optimizer=optimizer,
    loss=make_combined_loss(output_size, use_perceptual=True),
    jit_compile=False
)
```

**Loss components** (ported from `train_fsrcnn_multi.py` lines 77-213):

- **MAE**: Pixel-level accuracy
- **MS-SSIM** (multi-scale): Structural similarity, adapts to output size
- **Perceptual (VGG19)**: Feature-space similarity, blocks 1-3
- **Gradient sanitization**: `@tf.custom_gradient` zeros NaN/Inf gradients from SSIM
- **Finite guards**: `tf.where(tf.math.is_finite(x), x, 0)` on all loss terms

### 2. Data Pipeline: cairosvg Required, 80% Real Icons, Icon-Like Synthetics

**Files**: `scripts/train_espcn_multi.py`, `scripts/train_fsrcnn_multi.py`

```python
# AFTER: cairosvg is a hard requirement (import at top, fail fast)
import cairosvg  # Required — no try/except fallback

# SVG verification
data = response.read()
if len(data) > 1024:  # Non-trivial SVG
    return data

# 80% target real icons
target_real = int(n * 0.8)

# Icon-like synthetic patterns (not circles):
# - Rounded rectangles (app icon style)
# - Horizontal bars (text-like)
# - Vertical bars
# - Cross/plus shapes
```

### 3. Epochs Increased for Large Scales

**Files**: Both training scripts — `MODEL_CONFIGS` updated

| Input | Scale     | Old ESPCN | Old FSRCNN | **New Both** |
| ----- | --------- | --------- | ---------- | ------------ |
| 16    | 32x (512) | 150       | 250        | **250**      |
| 16    | 24x (384) | 130       | 220        | **250**      |
| 16    | 16x (256) | 120       | 200        | **250**      |
| 16    | 12x (192) | 100       | 180        | **220**      |
| 16    | 8x (128)  | 80        | 150        | **200**      |
| 16    | 4x (64)   | 64        | 120        | **120**      |
| 16    | 2x (32)   | 40        | 80         | **80**       |
| 32    | 16x (512) | 120       | 200        | **250**      |
| 32    | 12x (384) | 100       | 180        | **220**      |
| 32    | 8x (256)  | 80        | 160        | **200**      |
| 32    | 6x (192)  | 70        | 140        | **150**      |
| 32    | 4x (128)  | 60        | 120        | **120**      |
| 32    | 2x (64)   | 35        | 80         | **80**       |
| 64    | 8x (512)  | 100       | 160        | **250**      |
| 64    | 6x (384)  | 80        | 140        | **200**      |
| 64    | 4x (256)  | 70        | 120        | **150**      |
| 64    | 3x (192)  | 60        | 100        | **100**      |
| 64    | 2x (128)  | 40        | 80         | **80**       |
| 256   | 2x (512)  | 150       | 150        | **200**      |

### 4. Bicubic-Baseline Validation (Both Scripts)

```python
# AFTER: Model must beat bicubic by +0.5dB PSNR
for _ in range(10):
    test_input = np.random.rand(1, input_size, input_size, 3).astype(np.float32)
    # ... run model ...
    bicubic = tf.image.resize(test_input, (output_size, output_size), method="bicubic")

    model_psnr = tf.image.psnr(output, hr_target, max_val=1.0).numpy()
    bicubic_psnr = tf.image.psnr(bicubic, hr_target, max_val=1.0).numpy()

if mean_model_psnr < mean_bicubic_psnr + 0.5:
    raise RuntimeError(f"Model PSNR {model_psnr:.2f}dB not better than bicubic {bicubic_psnr:.2f}dB + 0.5dB")
```

### 5. Batch Size Reduced, Gradient Clipping Added

```python
# AFTER: Both scripts
batch_size = 16 * strategy.num_replicas_in_sync  # Was 32 for ESPCN
optimizer = keras.optimizers.Adam(learning_rate=1e-4, clipnorm=1.0)  # Was default LR, no clip
```

### 6. generate-model.js: Self-Healing Venv

**File**: `scripts/generate-model.js`

```javascript
// AFTER: Auto-runs train-setup.sh if venv missing
if (!fs.existsSync(venvPython)) {
  console.log("[MODEL] Python virtual environment not found, running setup...");
  execFileSync("bash", ["scripts/train-setup.sh"], {
    stdio: "inherit",
    cwd: projectRoot,
  });
}
```

---

## Files Modified

| File                            | Purpose                                                                               | Lines Changed      |
| ------------------------------- | ------------------------------------------------------------------------------------- | ------------------ |
| `scripts/train_espcn_multi.py`  | **Complete rewrite** — perceptual loss, data pipeline, epochs, validation, batch size | ~400 (entire file) |
| `scripts/train_fsrcnn_multi.py` | Epochs sync, data pipeline sync, bicubic validation                                   | ~150               |
| `scripts/generate-model.js`     | Self-healing venv auto-setup                                                          | ~25                |

**Files NOT modified** (already correct):

- `scripts/train-setup.sh` — Environment bootstrap (uv, Python 3.12, TF 2.19, GPU verify)
- `requirements-gpu.txt` — `tensorflow[and-cuda]==2.19.0` (bundles CUDA 12.5 + cuDNN 9.3)
- `requirements-cpu.txt` — `tensorflow-cpu==2.19.0`
- `scripts/train.sh` — Wrapper with preflight checks, TF_XLA_FLAGS, TF_CPP_MIN_LOG_LEVEL
- `src/services/iconProcessing.ts` — `MODEL_REGISTRY` (70 models, matches training output)
- `src/services/iconUpscaler.ts` — Bilinear fallback, crawl-time disabled
- `scripts/generate-model-map.js` — Metro bundling map generator
- `scripts/generate-model-registry.js` — Registry with file sizes

---

## App Wiring (Already Complete, No Changes Needed)

The React Native app expects exactly these 70 model filenames:

**ESPCN "fast" (35 models)**:

```
espcn_16x_32x.tflite      espcn_16x_64x.tflite      espcn_16x_128x.tflite
espcn_16x_192x.tflite     espcn_16x_256x.tflite     espcn_16x_384x.tflite
espcn_16x_512x.tflite
espcn_32x_64x.tflite      espcn_32x_128x.tflite     espcn_32x_192x.tflite
espcn_32x_256x.tflite     espcn_32x_384x.tflite     espcn_32x_512x.tflite
espcn_48x_96x.tflite      espcn_48x_144x.tflite     espcn_48x_192x.tflite
espcn_48x_240x.tflite     espcn_48x_384x.tflite     espcn_48x_576x.tflite
espcn_64x_128x.tflite     espcn_64x_192x.tflite     espcn_64x_256x.tflite
espcn_64x_384x.tflite     espcn_64x_512x.tflite
espcn_96x_192x.tflite     espcn_96x_288x.tflite     espcn_96x_384x.tflite
espcn_96x_480x.tflite     espcn_96x_576x.tflite
espcn_128x_256x.tflite    espcn_128x_384x.tflite    espcn_128x_512x.tflite
espcn_192x_384x.tflite    espcn_192x_576x.tflite
espcn_256x_512x.tflite
```

**FSRCNN "sharp" (35 models)**:

```
fsrcnn_16x_32x.tflite     fsrcnn_16x_64x.tflite     fsrcnn_16x_128x.tflite
fsrcnn_16x_192x.tflite    fsrcnn_16x_256x.tflite    fsrcnn_16x_384x.tflite
fsrcnn_16x_512x.tflite
fsrcnn_32x_64x.tflite     fsrcnn_32x_128x.tflite    fsrcnn_32x_192x.tflite
fsrcnn_32x_256x.tflite    fsrcnn_32x_384x.tflite    fsrcnn_32x_512x.tflite
fsrcnn_48x_96x.tflite     fsrcnn_48x_144x.tflite    fsrcnn_48x_192x.tflite
fsrcnn_48x_240x.tflite    fsrcnn_48x_384x.tflite    fsrcnn_48x_576x.tflite
fsrcnn_64x_128x.tflite    fsrcnn_64x_192x.tflite    fsrcnn_64x_256x.tflite
fsrcnn_64x_384x.tflite    fsrcnn_64x_512x.tflite
fsrcnn_96x_192x.tflite    fsrcnn_96x_288x.tflite    fsrcnn_96x_384x.tflite
fsrcnn_96x_480x.tflite    fsrcnn_96x_576x.tflite
fsrcnn_128x_256x.tflite   fsrcnn_128x_384x.tflite   fsrcnn_128x_512x.tflite
fsrcnn_192x_384x.tflite   fsrcnn_192x_576x.tflite
fsrcnn_256x_512x.tflite
```

**Registry**: `assets/models/model_registry.json` (auto-generated by `generate-model-registry.js`)

**Metro Map**: `src/services/generatedModelMap.ts` (auto-generated by `generate-model-map.js`)

---

## Hardware Requirements

### Minimum

- **VRAM**: 16 GB (batch 16 works, batch 32 needs 24 GB)
- **Driver**: NVIDIA >= 525 (for CUDA 12.5)

### Recommended Rental Options

| Instance     | GPU | VRAM  | Est. Time (70 models) | Cost/hr | Est. Total |
| ------------ | --- | ----- | --------------------- | ------- | ---------- |
| **RTX 4090** | 1×  | 24 GB | 18-24 hrs             | ~$0.69  | **$12-17** |
| **A10G**     | 1×  | 24 GB | 22-28 hrs             | ~$1.10  | **$24-31** |
| **A100**     | 1×  | 40 GB | 14-18 hrs             | ~$1.80  | **$25-32** |

**Providers**: RunPod, Lambda Labs, Vast.ai, Google Cloud (A100), AWS (g5.xlarge = A10G)

---

## How to Run Training (On Rented GPU Instance)

```bash
# 1. Clone / pull latest
git clone <repo> && cd <repo>
# OR if already cloned:
git pull

# 2. One-command setup (installs uv, Python 3.12, TF 2.19[CUDA], verifies GPU)
npm run train:setup
# OR: bash scripts/train-setup.sh

# 3. Train all 70 models (fast + sharp)
npm run train:models
# OR: bash scripts/train.sh --both

# 4. Force retrain everything (ignore existing models)
npm run train:models:force
# OR: bash scripts/train.sh --both --force

# 5. Train single model for testing
npm run train:models -- --model=16_512 --quality=fast
# OR: bash scripts/train.sh --fast --model=16_512
```

### Expected Output (Success)

```
[TRAIN] Training 16->512 (scale 32x, 250 epochs)
[TRAIN] Model params: 1,234
[TRAIN] MS-SSIM scales: 5 (output 512px)
...
Epoch 250/250 - loss: 0.0234 - val_loss: 0.0241
[TRAIN] WROTE /path/espcn_16x_512x.tflite (127592 bytes)
[VALIDATE] Output variance: 0.012345
[VALIDATE] Model PSNR: 28.45dB, Bicubic PSNR: 26.12dB
[VALIDATE] PASSED - Model beats bicubic baseline by 2.33dB
```

### Failure Modes (Will Exit Non-Zero)

- `MODEL VALIDATION FAILED: Output variance too low (constant gray)`
- `MODEL VALIDATION FAILED: Model PSNR not better than bicubic + 0.5dB`
- `cairosvg/pillow import failed` → need `apt-get install -y libcairo2`
- `TensorFlow cannot see any GPU` → driver issue, run `nvidia-smi`

---

## Key Design Decisions (Why This Way)

### Why Perceptual + MS-SSIM + MAE?

- **MAE alone** → blurry, over-smoothed (minimizes pixel diff, ignores structure)
- **SSIM alone** → can produce artifacts, unstable gradients
- **Perceptual (VGG)** → captures semantic features (edges, textures) but needs MAE anchor
- **Combined** → each term covers the others' weaknesses; gradient sanitization prevents NaN propagation

### Why 80% Real Icons?

- Real icons have: text, sharp corners, brand-specific shapes, transparency handling
- Synthetic circles/rectangles teach the model nothing about icon structure
- 80% target ensures sufficient real diversity; 20% icon-like synthetic fills gaps

### Why Bicubic Baseline +0.5dB?

- Bicubic is the "do nothing" baseline — model must justify its compute cost
- +0.5dB is a modest but meaningful margin (clearly better, not noise)
- Prevents shipping models that are worse than classical interpolation

### Why `tensorflow[and-cuda]==2.19.0` (Not System CUDA)?

- **Self-contained**: Bundles CUDA 12.5 + cuDNN 9.3 as pip wheels
- **No system CUDA toolkit needed** — only NVIDIA driver (>=525)
- **Reproducible**: Exact same binary on every machine
- **TF 2.19** is last version supporting Python 3.12 (3.13+ not supported)

### Why `train-setup.sh` Bootstraps `uv`?

- `uv` installs standalone Python 3.12 without root
- Works on minimal containers (no `apt`, no `pyenv`, no `conda`)
- Single binary, fast, reliable

---

## Troubleshooting Checklist

| Symptom                               | Likely Cause                   | Fix                                        |
| ------------------------------------- | ------------------------------ | ------------------------------------------ |
| `nvidia-smi` works but TF sees no GPU | Driver/kernel module mismatch  | Reboot instance, reinstall driver          |
| `cairosvg` import fails               | Missing `libcairo2`            | `apt-get install -y libcairo2`             |
| Training OOM (CUDA out of memory)     | Batch size too large           | Reduce `batch_size` in scripts (16 → 8)    |
| Validation fails: variance too low    | Model collapsed to constant    | Check loss weights, increase epochs        |
| Validation fails: not beating bicubic | Insufficient epochs / bad data | Increase epochs, verify real icon download |
| `generate-model.js` fails             | Venv missing                   | Run `npm run train:setup` first            |

---

## Git History Context

**Commit 11c3fe1** (previous working state):

- XLA fix working
- 576px cap working
- MirroredStrategy fixed (multi-GPU only)
- TF warnings suppressed
- Syntax checks passing

**This fix** (uncommitted, ready to commit):

- All 7 code fixes documented above
- Ready for `git add -A && git commit -m "Fix training quality: perceptual loss, data pipeline, epochs, bicubic validation"`

---

## What Could Still Go Wrong (Risk Mitigation)

1. **Real icon download fails** (CDN rate limits, network)
   - Mitigation: `TRAINING_BRANDS` has 30 brands, only need ~8 per size; synthetic fallback is icon-like

2. **VGG perceptual loss too strong/weak**
   - Mitigation: Weights (MAE=1.0, SSIM=0.15, Perceptual=0.05) match FSRCNN which was validated

3. **Epochs still insufficient for 8x**
   - Mitigation: 250 epochs at batch 16 = ~4000 steps; monitor validation loss, can re-run with `--force --model=16_512`

4. **GPU instance has old driver (<525)**
   - Mitigation: `train-setup.sh` smoke test catches this pre-training

5. **Metro bundling misses new models**
   - Mitigation: `build-android.sh` runs `generate-model-map.js` automatically; `npm run generate-model-map` also works

---

## Quick Reference: Key Commands

```bash
# Setup
npm run train:setup              # Auto-detect GPU/CPU
npm run train:setup:gpu          # Force GPU
npm run train:setup:cpu          # Force CPU

# Training
npm run train:models             # Both fast + sharp
npm run train:models:force       # Force retrain all
npm run train:models:fast        # ESPCN only
npm run train:models:sharp       # FSRCNN only
npm run train:models -- --model=16_512 --quality=fast  # Single model

# Registry/Map (auto-run after train.sh)
npm run train:registry           # model_registry.json
npm run generate-model-map       # generatedModelMap.ts

# Verification
bash scripts/verify-android.sh   # Full Android build test
```

---

## Final Note

**The environment was never the problem.** The training scripts were producing mathematically valid but visually useless models because:

1. Loss function lacked perceptual guidance
2. Training data didn't resemble icons
3. Epochs were too low for hard scales
4. Validation didn't measure actual quality

All fixed. The next GPU rental should produce models that **visibly improve** over bicubic interpolation on real app icons.

---

_Document generated 2026-04-08. Commit this file to preserve context for future runs._
