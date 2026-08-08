# AI Icon Upscaling — Single Source of Truth

**Last updated:** 2026-08-08  
**Status:** Brand-safe freeze in app + trainers; full matrix retrain via `npm run train:models:force`

This file **replaces and merges**:

| Former file | Content folded in |
| ----------- | ----------------- |
| `AI_UPSCALING_IMPLEMENTATION.md` | App matrix, runtime, build wiring |
| `TRAINING_FIXES.md` | Strategy log, eras, cascade/hybrid, freeze |
| `TRAINING_FIX_DOCUMENTATION.md` | Early quality fiasco + fixes |
| `TRAINING_GPU_MEMORY.md` | Multi-GPU / VRAM / isolate |

Those four paths remain as **short stubs** pointing here so old links still work.

**Also see (not merged):** `GARBAGE_REPORT.md`, `CATASTROPHE_ANALYSIS*.md` (project autopsy / gray-black era detail).

---

## Table of contents

1. [Goal](#1-goal)
2. [Current frozen strategy](#2-current-frozen-strategy)
3. [App implementation](#3-app-implementation)
4. [Training](#4-training)
5. [GPU memory & multi-GPU](#5-gpu-memory--multi-gpu)
6. [History (methods tried)](#6-history-methods-tried)
7. [Research notes](#7-research-notes)
8. [Brainstorm (post-freeze ideas)](#8-brainstorm-post-freeze-ideas)
9. [POC artifacts](#9-poc-artifacts)
10. [Backburner](#10-backburner)
11. [Changelog](#11-changelog)
12. [Quick links](#12-quick-links)

---

## 1. Goal

Upscale tiny **brand favicons** (often 16×16) to display size (~192–512) **on-device** with TFLite:

- Sharper / less mushy than bilinear alone  
- **Brand-safe:** stroke weight, color (esp. reds), recognizable mark  
- User bar (Aug 2026): ~30–50% better *perceived* quality — slight PSNR wins are not enough  

**Not the goal:** beat Real-ESRGAN on photos. **Is the goal:** subscription icons that still look like the brand.

---

## 2. Current frozen strategy

| Layer | Choice |
| ----- | ------ |
| **Inference** | TFLite SR → **bilin + 0.25 · clamp(residual)** → alpha restore |
| **Train arch** | Residual FSRCNN/ESPCN: `bilin(LR) + depth_to_space(zero-init subpixel)` |
| **Train loss** | MAE-first + color_preserve(0.25) + stroke_mass(0.20) + mild edge(0.08) + light SSIM/VGG |
| **Train LR** | Mild degrade (~80% bicubic, rare light JPEG q75–95) |
| **Export** | **Float32 TFLite only** — never `Optimize.DEFAULT` quant (destroyed reds) |
| **Entry** | `npm run train:models:force` |
| **Not default** | Cascade hops, edge w=0.35, heavy degrade, full unbounded model residual |

### Inference formula (`src/services/iconProcessing.ts`)

```text
out = bilin + t * clamp(model − bilin, −max_darken, +max_brighten)

t            = 0.25   # BRAND_SAFE_LERP_T  (between user picks 80/20 and 70/30)
max_darken   = 0.12   # BRAND_SAFE_MAX_DARKEN
max_brighten = 0.35   # BRAND_SAFE_MAX_BRIGHTEN
```

Log: `[ICON_AI] brand-safe hybrid t=0.25 (bilin + clamped residual)`

Hybrid works on **existing** tflites immediately. Retrain improves the residual so it fights bilin less.

### Train loss (both multi trainers)

```text
loss = MAE
     + 0.10 * (MS-)SSIM
     + 0.25 * color_preserve_loss   # mean RGB + 5×5 blur L1
     + 0.20 * stroke_mass_loss      # 7×7 low-pass luma + ink area (anti-thin)
     + 0.08 * sobel_edge_loss       # mild; --no-edge to disable
     + 0.02 * VGG perceptual        # only when gate enables it
```

---

## 3. App implementation

### Families

| Mode | Models | Role |
| ---- | ------ | ---- |
| **fast** | ESPCN | Smaller / quicker |
| **sharp** | FSRCNN | Default quality path |

Fallback chain: requested quality → other family if bundled → **bilinear** (`upscaleIconIfSmall`).

### Model matrix (configured)

| Input | Outputs (scales) |
| ----- | ---------------- |
| 16 | 64(4×) 128(8×) 192(12×) 256(16×) 384(24×) 512(32×) |
| 32 | 64(2×) 128(4×) 192(6×) 256(8×) 384(12×) 512(16×) |
| 48 | 96(2×) 144(3×) 192(4×) 240(5×) 384(8×) 576(12×) |
| 64 | 128(2×) 192(3×) 256(4×) 384(6×) 512(8×) |
| 96 | 192(2×) 288(3×) 384(4×) 480(5×) |
| 128 | 256(2×) 384(3×) 512(4×) FSRCNN |
| 192 | 384(2×) 576(3×) |
| 256 | 512(2×) |

~32 ESPCN + ~33 FSRCNN configured. **What ships** = files present in `assets/models/` via generated map.

No 1× models (`depth_to_space` scale=1 is invalid).

### Wiring layers

| Piece | Path | Notes |
| ----- | ---- | ----- |
| Selection registry | `src/services/iconProcessing.ts` `MODEL_REGISTRY` | Which file for input/scale/quality |
| Bundle map | `src/services/generatedModelMap.ts` | **Auto** from `assets/models/*.tflite` |
| Codegen | `npm run train:map` / `generate-model-map` | Also during Android build |
| Runtime | `upscaleIconAi()` | White-composite in → model → brand-safe hybrid → alpha → PNG |
| UI | Icon picker quality toggle | sharp / fast |

**Do not hand-edit** `generatedModelMap.ts`.

### Runtime path (detail)

1. `Image.getSize` → nearest registry input; target from `PixelRatio` (base 64×ratio, clamp 64–512)  
2. Load TFLite via `react-native-fast-tflite`  
3. Resize to model input (expo-image-manipulator)  
4. Decode PNG → RGBA; **white-composite** RGB (match training)  
5. `model.runSync`  
6. Variance gate (near-constant → bilin fallback)  
7. **Brand-safe hybrid** with bilin upsample of LR  
8. NN-upsample alpha; un-composite if translucent  
9. Encode PNG base64  

Crawl-time auto-upscale is **disabled**; store original res; upscale on user action.

### Ship models to app

```bash
# after copying *.tflite into assets/models/
npm run train:map
# rebuild/install APK as usual, e.g.
npm run build:android:x86_64:cache
```

---

## 4. Training

### Scripts

| Script | Role |
| ------ | ---- |
| `scripts/train_fsrcnn_multi.py` | Sharp production |
| `scripts/train_espcn_multi.py` | Fast production |
| `scripts/train.sh` | Wrapper (isolate, multi-GPU env) |
| `scripts/train_fsrcnn.py` | Redirect → multi |
| `scripts/train_espcn_fast.py` | Redirect → multi |
| `scripts/train_espcn_perceptual.py` | Redirect → multi |
| `scripts/train-setup.sh` | venv / GPU deps |

### npm commands

```bash
npm run train:setup:gpu          # once per machine
npm run train:models:force       # full fast+sharp matrix, overwrite
npm run train:models             # resume (skip existing tflite)
npm run train:models:sharp:force
npm run train:models:fast:force
npm run train:models:sharp:force:model -- 16_192   # if args passthrough works
npm run train:map
```

Equivalent: `bash scripts/train.sh --both --force`

### Data

- Prefer real icons (Simple Icons / Tabler SVG → raster)  
- Synthetic icon-like shapes as supplement (incl. solid color fields for residual head)  
- Mild LR degradation (see freeze table)  
- Augment: flip / small geometric / brightness (as implemented in trainers)

### Validation gates

1. Not constant / healthy variance  
2. **Hard-sample PSNR** vs bicubic (skip near-solid pairs where bicubic PSNR ≥ ~40 dB — avoids false FAIL)  
3. **Solid R/G/B color gate** (catch red→gray wash)  
4. Float TFLite round-trip sanity where implemented  

Healthy logs: `ColorPreserve`, `StrokeMass`, `Edge: on (w=0.08)`, `[VALIDATE] PASSED`, `[TRAIN] WROTE …tflite`

### Architecture (both families)

```text
out = bilinear_upsample(LR, scale) + depth_to_space( Conv_subpixel_zero_init( body(LR) ) )
```

- Zero-init subpixel ⇒ train starts at bilin floor (color/mass anchored)  
- **Bug to never repeat:** zeroing a head *after* depth_to_space (body learned garbage HR)

### Early quality fixes (still in force)

From the original training fiasco (constant gray / worse than bicubic):

| Fix | Why |
| --- | --- |
| Real icons, not silent synthetic-only | Circles ≠ logos |
| Size-normalized VGG perceptual | Loss 33 → ~3–4 |
| Validate vs **real HR**, not dummy | Meaningful gate |
| Beat-bicubic + color gate | Catch soft/wash |
| Dynamic batch by **output** size | OOM / stability |
| Self-heal venv in generate-model path | Fewer footguns |
| Longer epochs on large scales | Undertrained mush |

---

## 5. GPU memory & multi-GPU

**Reference hardware:** 2× NVIDIA RTX 4000 Ada (~20 GB each)

### Mental model

| Fact | Meaning |
| ---- | ------- |
| Data-parallel (MirroredStrategy) | Full replica per GPU + batch shard |
| Peak VRAM | ≈ **one card**, not 40 GB pooled |
| More GPUs | **Faster**, not larger jobs |
| Isolate subprocess | Peak = worst single model, not sum of matrix |

### What broke full-matrix runs

1. `RESOURCE_EXHAUSTED` OOM (e.g. VGG maps on 48→240)  
2. Cascading `Dst tensor is not initialized` after allocator death  
3. Two GPUs visible but `USE_MULTI_GPU` defaulted **false** → paid for idle card  
4. `mixed_float16` + SSIM/VGG dtype mismatch → later **disabled** mixed; train float32  

### Fixes in trainers / `train.sh`

1. `USE_MULTI_GPU=true` by default when ≥2 GPUs  
2. `set_memory_growth(True)` on all GPUs  
3. `release_gpu_memory()` between in-process jobs  
4. **`TRAIN_ISOLATE=true` (default):** one subprocess per model  
5. Safer batches when perceptual on  
6. Resume: omit `--force` → `[SKIP]` existing tflite  

```bash
USE_MULTI_GPU=false bash scripts/train.sh --both --force   # single GPU
TRAIN_ISOLATE=false bash scripts/train.sh --both --force # in-process + release
bash scripts/train.sh --fast --force --model 48_240      # one model
```

Expect: `MirroredStrategy with 2 GPUs`, `Subprocess isolate 16->32`, `[SKIP] … exists`

---

## 6. History (methods tried)

### Era A — Catastrophe (gray / black)

Unpinned TF/CUDA · bad export · **quantized TFLite** · synthetic-only data  
→ Float only; pin stack; real icons. See `CATASTROPHE_ANALYSIS*.md`.

### Era B — Loss & validation correctness

Normalized perceptual · lower ESPCN VGG weight · validate vs real HR · batch by output size  

### Era C — GPU lifecycle

Multi-GPU default · memory growth · isolate subprocess · drop mixed_float16  

### Era D — Residual architecture & color

| Attempt | Result |
| ------- | ------ |
| Direct FSRCNN/ESPCN | Soft; color risk |
| Residual, zero head **after** D2S | **Bug** PSNR ≪ bicubic |
| Residual bilin + zero-init **subpixel** | Floor = bilin; TFLite-safe |
| Solid RGB gate | Catch wash |
| MAE+SSIM residual 16→192 | +~1 dB; user: “not enough” |

### Era E — Ace one-shot POC

`poc_out/`: model slightly > bilin, far from SVG HR. 12× from 16px cannot match vector.

### Era F — Cascade → hybrid → brand-safe (2026-08-08)

**F1 Cascade v1** (edge 0.35, heavy degrade, 16→32→64→128→256):  
hard-sample **+2.4…+7.4 dB**, RGB gate pass — **Ace brand fail** (gray, thin, scribble).  
Artifacts: `assets/models_cascade/`, `poc_out_cascade/`.

**F2 Rollback:** edge→0.08, mild LR, color_preserve, later stroke_mass; cascade off default.

**F3 Hybrid POC:** bilin fuller; model thinner. Variants freq/mask/clamp/combo — `poc_out_hybrid/`.

**F4 Brand-safe grid:** user preferred **lerp 80/20–70/30**; full clamp thins letters. Freeze **t=0.25**.  
`poc_out_hybrid_brand/`, `poc_brand_safe_picks.png`.

**F5 Ship:** app hybrid + trainer losses + legacy train script redirects.

**Lesson:** PSNR ≠ brand OK. Heavy edge + multi-hop compound is wrong default for logos.

---

## 7. Research notes

Progressive 2× (LapSRN, ProSR, waifu2x, Real-ESRGAN zoo) is still right for *photo sharpness*.  
We **import structure**, not unbounded perceptual/GAN tails:

| Take | Use |
| ---- | --- |
| 2× cascade | Backburner, only with hybrid each hop |
| Edge/gradient loss | **Mild** only |
| Degradation-matched LR | Mild JPEG/resize |
| GAN / heavy perceptual | Last resort (hallucination on marks) |

**vs research honesty:**

- Photo SOTA sharpness: research wins  
- Unattended mobile **logos**: our bilin-first freeze is the better *product* fit  
- High-quality input (64–512 / SVG): often **skip SR**; native source beats both  

At 32/48/64px side-by-side: research usually sharper; we usually safer on stroke mass.

---

## 8. Brainstorm (post-freeze ideas)

*Not shipped. Explore only after freeze + visual OK on current path.*

### 8.1 Ours vs research at better inputs

| Input | Research (e.g. Real-ESRGAN x2/x4) | Ours (hybrid t=0.25) |
| ----- | -------------------------------- | -------------------- |
| 16 | Sharper, identity lottery | Safer, softer |
| 32 | Usually sharper | Safer / tie on bold marks |
| 48–64 | Slight edge or tie | Often “good enough” |
| 128+ | Diminishing; **source wins** | Same |

### 8.2 Stack patterns

**A — Ours then research tail**

```text
LR → brand-safe hop → mid → RealESRGAN/waifu2x → out
```

Sharper; **undoes** brand safety unless tail is leashed again (`lerp(mid, research, t)`).

**A′ (interesting offline):** mid → research x2 → lerp back to mid.

**B — waifu2x-style cascade of *our* 2× cells**

```text
16 →2× hybrid→ 32 →2× hybrid→ 64 →2× hybrid→ 128 → …
```

- Right way to import waifu2x *structure* on-device  
- Needs **lerp every hop** or compound thin returns (cascade v1)  
- Fewer hops + slightly higher t on last hop often best  
- Latency: N TFLite runs  

**C — SOTA inside our envelope**

```text
out = bilin + t * clamp(research_upscale − bilin)
```

Best “have cake” **offline** experiment; weights likely too big on-device unless distilled.

**D — Ours then actual waifu2x weights**

Illustration-friendly; can redraw curves; leash each hop or accept brand drift.

### 8.3 Storyboard

| Pipeline | Sharpness | Brand mass |
| -------- | --------- | ---------- |
| Current one-shot + lerp | Medium | High |
| Cascade v1 raw | High metrics | Low |
| B: our 2× + lerp each hop | Medium–high | Medium–high |
| A: ours then raw research | High | Medium→Low |
| A′ / C leashed research | High | High |

### 8.4 Practical brainstorm verdict

1. Don’t ship unleashed research on top of freeze.  
2. Best on-device evolution: **route large targets through 2–3 brand-safe 2× hops** (matrix already has many 2× rungs).  
3. Best quality ROI overall: **larger crawl sources** (SVG, apple-touch), not a bigger upscaler.  
4. Desktop A/B later: Ace at 16/32/48 — current path vs `bilin+t*(RealESRGAN−bilin)` vs hybrid 2× chain.

---

## 9. POC artifacts

| Path | What |
| ---- | ---- |
| `poc_out/` | Early one-shot Ace |
| `poc_out_svg/` | SVG-derived contact |
| `poc_out_cascade/` | Cascade v1 |
| `poc_cascade_*.png` | Cascade vs one-shot sheets |
| `poc_out_hybrid/` | Hybrid A/B/C/combo |
| `poc_out_hybrid_brand/` | Lerp/clamp brand grid |
| `poc_brand_safe_*.png` | User pick sheets |
| `assets/models_cascade/` | Cascade tflites (not app default) |
| `scripts/poc_upscale_smoke.py` | Desktop ↔ app path smoke |
| `scripts/poc_hybrid_composite.py` | Hybrid / brand grids |

---

## 10. Backburner

1. App **2× cascade routing** with hybrid each hop (waifu2x-style, our weights)  
2. Prefer **larger sources** at crawl (SVG / apple-touch / og:image)  
3. Optional debug: expose lerp `t` in settings  
4. Trim unused extreme one-shot scales from bundle once routing is smart  
5. Offline leashed Real-ESRGAN / waifu2x experiments (not default path)  
6. GAN-class only with human QA  

**Freeze criteria before backburner:** mechanical hybrid OK + user visual OK on retrain.

---

## 11. Changelog

| Date | Change |
| ---- | ------ |
| 2026-04 / early | Training fiasco doc: MAE-only, synthetic data, weak val |
| 2026-08-05 | Loss normalize, val vs HR, batch/OOM fixes |
| 2026-08-06 | GPU isolate, multi-GPU, memory growth |
| 2026-08-07 | Correct residual; hard-sample PSNR; Ace slightly > bilin |
| 2026-08-08 | Cascade POC metrics win / brand fail |
| 2026-08-08 | Hybrid + brand-safe grid; freeze t=0.25 |
| 2026-08-08 | App hybrid; stroke_mass + color_preserve trainers |
| 2026-08-08 | **Merged** four docs → this file; brainstorm §8 |

---

## 12. Quick links

| Path | Topic |
| ---- | ----- |
| `src/services/iconProcessing.ts` | Runtime + hybrid |
| `scripts/train_fsrcnn_multi.py` | Sharp trainer |
| `scripts/train_espcn_multi.py` | Fast trainer |
| `scripts/train.sh` | npm train backend |
| `package.json` `train:*` | Commands |
| `GARBAGE_REPORT.md` | Project autopsy |
| `CATASTROPHE_ANALYSIS*.md` | Gray/black era |
| `assets/models/` | Shipped tflites |
