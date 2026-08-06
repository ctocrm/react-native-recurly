# Training GPU memory & multi-GPU (Aug 2026 findings)

**Hardware reference:** 2× NVIDIA RTX 4000 Ada, **20475 MiB (~20 GB) each**  
**Code:** `scripts/train_espcn_multi.py`, `scripts/train_fsrcnn_multi.py`, `scripts/train.sh`

---

## What was actually broken (last VPS force run)

Quality path was **working**. Models that finished training **PASSED** validation (beat bicubic, healthy variance), e.g.:

| Model        | Δ vs bicubic                 |
| ------------ | ---------------------------- |
| 16→32        | +2.68 dB                     |
| 16→64        | +0.90 dB                     |
| 16→128       | +0.12 dB                     |
| 16→192 (12×) | +0.51 dB                     |
| 32→64        | +2.80 dB                     |
| 48→96        | +3.11 dB                     |
| …            | (10 models written that run) |

Then the matrix died with:

1. **`RESOURCE_EXHAUSTED` OOM** (e.g. `48→240` batch 4, VGG feature maps `[4,64,240,240]`)
2. Cascading **`Dst tensor is not initialized`** on almost everything after — classic TF after GPU allocator is exhausted / graphs not torn down between jobs

Log also showed:

```text
GPU: ['/physical_device:GPU:0', '/physical_device:GPU:1']
[TRAIN] Using single device strategy
```

Two cards visible; **only one used**, because `USE_MULTI_GPU` defaulted to **`false`** (`7d41d00` “Fix OOM & NCCL”). That did **not** fix sequential OOM; it only disabled data-parallel speed while you paid for 2 GPUs.

---

## Memory model (correct mental model)

| Fact                                           | Meaning                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| **Data-parallel multi-GPU** (MirroredStrategy) | Each GPU holds a **full model replica** + its batch shard                       |
| **Peak VRAM**                                  | ≈ **one card** (~20 GB), **not** 2×20 = 40 GB pooled                            |
| **1 / 2 / 4 GPUs**                             | Same jobs that fit on 1×20 GB; more GPUs → **faster**, not a bigger memory pool |
| **After teardown / subprocess**                | Peak = **worst single step**, not sum of all models in the matrix               |

Design target in batch tables: fit **RTX 4000 Ada class (~16–20 GB)** with headroom.

---

## Follow-up: mixed_float16 dtype (VPS log after 44c2e27)

With multi-GPU + `mixed_float16` re-enabled, perceptual jobs failed immediately:

```text
`x` and `y` must have the same dtype, got tf.float16 != tf.float32
```

Jobs with perceptual **disabled** (output ≥256) trained. Fix (app-compatible, train-only):

- Cast `y_true`/`y_pred` to **float32** in `combined_loss` and `perceptual_loss`
- Final Conv+sigmoid layers use **`dtype="float32"`** (Keras mixed-precision requirement)

Same `.tflite` names/shapes for the React app.

---

## What we fixed in code (GPU memory commit)

1. **`USE_MULTI_GPU` default `true`** when ≥2 GPUs (override `USE_MULTI_GPU=false`).
2. **`set_memory_growth(True)`** on all GPUs so TF does not grab the whole card at import.
3. **`release_gpu_memory()`** after each in-process job (`VGG_FEATURES = None`, `clear_session`, `gc.collect`).
4. **`TRAIN_ISOLATE=true` (default):** parent spawns **one subprocess per model** so process exit frees all VRAM (most reliable for a full matrix).
5. **Safer VGG batches** on 128–240 px outputs (batch 2 with perceptual where 4 OOM’d).
6. **Resume without retrain:** omit `--force` → existing `.tflite` skipped (`[SKIP]`).

---

## How to run on the VPS

```bash
# Full matrix (isolate + multi-GPU defaults on)
npm run train:models:force
# or
bash scripts/train.sh --both --force

# Resume only missing/failed (recommended after partial run)
bash scripts/train.sh --both
# (no --force)

# One failed model only
bash scripts/train.sh --fast --force --model 48_240

# Force single GPU
USE_MULTI_GPU=false bash scripts/train.sh --both --force

# In-process loop instead of subprocesses (still calls release_gpu_memory)
TRAIN_ISOLATE=false bash scripts/train.sh --both --force
```

Expect log lines like:

- `[TRAIN] Using MirroredStrategy with 2 GPUs` when both cards are up and multi-GPU on
- `[TRAIN] Subprocess isolate 16->32 ...` for each matrix entry
- `[SKIP] espcn_16x_32x.tflite exists` when resuming

---

## What was unnecessary

Once the shared recipe (real icons, normalized perceptual loss, validate vs real HR, beat-bicubic) worked, **hybrid special-casing** (moving validation margins, flip-flopping perceptual weights, “only single GPU forever”) was **not** required to finish the matrix. The remaining failure was **VRAM lifecycle + under-using rented GPUs**.

---

## Related docs

- `GARBAGE_REPORT.md` — full project chronology / waste inventory
- `TRAINING_FIXES.md` / `TRAINING_FIX_DOCUMENTATION.md` — earlier quality fixes (still relevant)
- `CATASTROPHE_ANALYSIS.md` — gray/black model era (historical)
