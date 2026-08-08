# Training Fixes & Strategy Log

Living document for **icon super-resolution** training (ESPCN + FSRCNN → TFLite).  
Covers methods tried, failures, research consensus, and the current strategy.

**Related:** `TRAINING_FIX_DOCUMENTATION.md` (early Aug quality fixes), `TRAINING_GPU_MEMORY.md` (VRAM/multi-GPU), `GARBAGE_REPORT.md` (project autopsy), `CATASTROPHE_ANALYSIS*.md` (gray/black era).

---

## Goal

Upscale tiny brand favicons (often **16×16**) to display size (**~192–512**) on-device with TFLite, **sharper and less mushy than bilinear/bicubic**, without washing brand colors (esp. reds).

User quality bar (Aug 2026): **~30–50% better perceived quality** than current output — sharper, less pixelated, less blurry. Slight PSNR wins are **not** enough.

---

## Methods tried so far (chronological)

### Era A — Catastrophe (constant gray / black)

| Method                                       | Result                                |
| -------------------------------------------- | ------------------------------------- |
| Unpinned TF/CUDA on rented GPU               | Broken graphs / wasted $              |
| Bad export / wrong ops                       | Gray or black TFLite                  |
| Quantization (`Optimize.DEFAULT`)            | Destroyed color on icon SR (red→gray) |
| Synthetic-only circles/rects (no real logos) | Models useless on brands              |

**Lesson:** Float TFLite only; pin stack; real icons required. See `CATASTROPHE_ANALYSIS*.md`.

---

### Era B — Infrastructure & loss correctness (early TRAINING_FIX_*)

| #   | Method                                            | Commit / note | Result                  |
| --- | ------------------------------------------------- | ------------- | ----------------------- |
| 1   | Dynamic batch + LR scale, multi-GPU flag          | `197f9b7`     | Stability across matrix |
| 2   | **Normalize perceptual loss by feature-map size** | `5083b97`     | Loss ~33 → ~3–4         |
| 3   | Lower ESPCN perceptual weight (tiny net)          | `3c5e851`     | ESPCN not overwhelmed   |
| 4   | Validate PSNR vs **real HR**, not constant 0.5    | `770b60f`     | Meaningful gate         |
| 5   | Batch by **output** size; NCCL opt-in             | `7d41d00`     | Fewer OOMs              |

**Lesson:** Perceptual must be size-normalized; validation must use paired HR.

---

### Era C — GPU lifecycle (TRAINING_GPU_MEMORY)

| Method                                     | Result                                                            |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `USE_MULTI_GPU` default true when 2+ GPUs  | Use both RTX 4000 Ada cards                                       |
| `set_memory_growth` + `release_gpu_memory` | Less sequential OOM                                               |
| `TRAIN_ISOLATE` subprocess per model       | Reliable VRAM free between jobs                                   |
| mixed_float16 + cast fixes                 | Then **disabled** mixed — fp16/fp32 fights under MirroredStrategy |

**Lesson:** Peak VRAM ≈ one card; isolate processes for full matrix.

---

### Era D — Architecture & color (mid–late Aug 2026)

| Method                                                                           | Result                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Direct FSRCNN / ESPCN (no residual)                                              | Soft; color risk                                                               |
| Residual with **zero head after** depth_to_space                                 | **Bug:** body learned garbage HR; PSNR 20.88 vs bicubic 27.40                  |
| **Correct residual:** bilinear(LR) + depth_to_space(**zero-init** subpixel conv) | Starts at bilinear floor; color anchored; TFLite-safe (bilinear builtin)       |
| Solid R/G/B color gate (Keras + TFLite)                                          | Catches wash-to-gray that still “beats bicubic” on icons                       |
| Float TFLite only (no quant)                                                     | Color preserved                                                                |
| VGG perceptual on large scales                                                   | Often soft or unstable; disabled for many large outs                           |
| MAE + MS-SSIM only (no perceptual) on residual 16→192                            | **Trains cleanly**; hard-sample PSNR **+0.96 dB**, 67% win rate                |
| User visual review of Ace POC                                                    | “Slightly better than traditional — **not good enough**” (want 30–50% sharper) |

**False FAIL (fixed):** Mean PSNR included solids where bicubic ≈ **140 dB**; model ~60 dB on solids dragged mean below bicubic.  
**Fix:** Hard-sample gate — skip val pairs with bicubic PSNR ≥ 40 dB; color gate covers solids.

---

### Era E — POC findings (Ace Hardware)

| Artifact                              | Meaning                                   |
| ------------------------------------- | ----------------------------------------- |
| `poc_out/05_model_alpha_restored.png` | **Model output** (app path)               |
| `poc_out/00_contact_sheet.png`        | LR \| bilinear \| model \| alpha-restored |
| `poc_out/ace_hr_from_svg.png`         | **SVG reference only** — not the network  |
| Live favicon 16×16 → fsrcnn_16×192    | Slightly > bilinear; still soft vs SVG HR |

**Lesson:** 12× one-shot from 16px cannot match SVG. Need progressive SR + sharper loss + better degradations + prefer larger sources.

---

## Research dump (web / papers / production tools)

**Question:** For large scale factors and soft output, is **2× cascade + edge loss + stronger residual hop** still best?

**Verdict: Yes**, with degradation-matched data. One-shot 12×/32× + MAE is what the field moved away from for _perceived_ sharpness.

### Papers

| Source                                                                                                          | Year  | Takeaway                                                           |
| --------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------ |
| **LapSRN** [arXiv:1704.03915](https://arxiv.org/abs/1704.03915), [1710.01992](https://arxiv.org/abs/1710.01992) | 2017  | Progressive Laplacian pyramid; multi-level residual reconstruction |
| **ProSR** [arXiv:1804.02900](https://arxiv.org/abs/1804.02900)                                                  | 2018  | Large factors hard; progressive arch + curriculum; scales to 8×    |
| **CARN** [arXiv:1803.08664](https://arxiv.org/abs/1803.08664)                                                   | 2018  | Cascading residual, lightweight                                    |
| **ESRGAN** [arXiv:1809.00219](https://arxiv.org/abs/1809.00219)                                                 | 2018  | MAE/MSE → over-smooth; perceptual (+ GAN) for visuals              |
| **Real-ESRGAN** [arXiv:2107.10833](https://arxiv.org/abs/2107.10833)                                            | 2021  | Realistic degradation synthesis; ships **×2/×4**, not ×12/×32      |
| **BSRGAN** [arXiv:2103.14006](https://arxiv.org/abs/2103.14006)                                                 | 2021  | Train degradation must match real LR or wild quality fails         |
| Edge / gradient loss papers                                                                                     | 2019– | Structure/sharpness without full GAN (good for logos)              |

### Production / community

| Tool            | Practice                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------ |
| **waifu2x**     | Native ~2× (4×); higher scales = **repeat 2×**                                             |
| **Real-ESRGAN** | Model zoo x2/x4; `--outscale` beyond net = **Lanczos after**; MSE nets labeled over-smooth |
| **chaiNNer**    | Product is **chaining** 2×/4× upscale nodes                                                |

### Implications for this app

1. **Cascade 2× (and some 4×)** for extreme targets — not monolithic 16→512.
2. **Edge/gradient loss** + L1 (+ light SSIM); full GAN last (brand hallucination risk).
3. **Degradation-aware LR** (JPEG, random resize kernels), not only clean bicubic of SVG.
4. **Stronger residual capacity** on hops that matter.
5. **Prefer larger favicon/SVG** in product — biggest free win.
6. **16→512 one-shot** ≈ same mush, more pixels — poor ROI until cascade works.
7. Matching SVG HR from true 16×16 is **not** fully recoverable — cascade closes the gap, not magic.

---

## Current strategy (post-research) — implement & POC

```
P0  Prefer largest source / SVG in app (product)
P1  Strong 2× (+ some 4×) models + cascade inference
    e.g. 16→32→64→128→256 (optional →512)
P2  Loss: L1 + Sobel/gradient edge + light SSIM; residual zero-init kept
P3  Favicon-like degradations when building LR from HR
P4  Higher capacity residual on 2× rungs
P5  Hard-sample PSNR gate + RGB color gate (keep)
P6  Optional light perceptual later; GAN only if still soft and colors locked
```

### POC plan (this iteration)

1. Train **2× cascade rungs** with edge loss + degradations + higher capacity:  
   `16→32`, `32→64`, `64→128`, `128→256` (pure 2×; 192 is not on the 2× lattice from 16).
2. POC script: **cascade** Ace favicon through chain; contact sheet vs bilinear vs old one-shot 16→192.
3. Human judge: is it clearly sharper (30%+ feel)?

### Not doing first

- Full matrix retrain of all extreme one-shots
- Monolithic 16→512 as quality bet
- Heavy Real-ESRGAN GAN on-device without distill

---

## Validation rules (do not regress)

1. **Hard-sample PSNR:** mean over val where bicubic PSNR < 40 dB; model must beat bicubic.
2. **Variance:** mean output var ≥ 0.001 (not constant gray).
3. **Color gate:** solid R, G, B patches keep channel dominance (Keras + TFLite).
4. **Float TFLite only** — no `Optimize.DEFAULT`.
5. **Human POC:** Ace contact sheet; model path = `05_model_alpha_restored` / cascade sheet — **not** `ace_hr_from_svg`.

---

## How to run

```bash
# 2× cascade rungs only (sharp path POC)
python scripts/train_fsrcnn_multi.py --cascade-rungs --force

# Single hop
python scripts/train_fsrcnn_multi.py --model=16_32 --force

# Cascade POC (Ace favicon)
python scripts/poc_upscale_smoke.py --cascade --out poc_out_cascade

# Full matrix (later)
bash scripts/train.sh --sharp --force
```

VPS (when SSH key authorized): host historically `root@172.238.35.154` (Linode/Akamai GPU).  
Local machine often has **no** TF/GPU — train on VPS.

---

## Key lessons (compressed)

1. Perceptual loss must be normalized by feature-map size.
2. Validate on real HR; hard-sample gate for solids.
3. Residual: zero-init **before** depth_to_space + bilinear base.
4. Quantization kills icon color.
5. MAE-only residual = correct but **soft** — need edge loss + cascade for “looks sharp.”
6. Large scale factors → progressive 2×/4× (research + waifu2x + Real-ESRGAN practice).
7. Train degradations must look like favicons.
8. More output pixels ≠ more quality if the method is still soft.
9. Stop paying GPU until the recipe is proven on a small POC.

---


---


### Cascade POC v1 — FAILED visual (2026-08-08)

User: _"Old is 1000 better… mostly black… Ace written by hand… lost the plot."_

| Metric | LR / old one-shot | Cascade v1 final |
| ------ | ----------------- | ---------------- |
| mean RGB | ~[0.98, 0.82, 0.84] (red OK) | ~[0.88, 0.87, 0.87] (**gray wash**) |
| dark% | 0% | **11.7%** (invented black) |
| Per-hop dark% | — | 0→5→10→11→12% (compounds) |

**Cause:** edge_weight=0.35 + aggressive JPEG/blur degradations + high capacity + 4-hop cascade. PSNR gate passed (sharp scribbles match edges) while **brand identity died**.

**v2 fix:** MAE-first, color_preserve w=0.25, edge w=0.08, mild degradations (80% bicubic), modest capacity, retrain cascade.


## Cascade POC results (2026-08-08, VPS 2× RTX 4000 Ada)

**Recipe:** residual FSRCNN + Sobel edge loss (w=0.35) + L1 + light SSIM + favicon degradations (JPEG/random resize); no VGG on cascade rungs; higher 2× capacity (d=64,s=16,m=8).

| Hop | Hard-sample Δ vs bicubic | Win rate | Status |
| --- | ------------------------ | -------- | ------ |
| 16→32 | **+2.39 dB** | 79% | PASSED + RGB OK |
| 32→64 | **+4.10 dB** | 93% | PASSED + RGB OK |
| 64→128 | **+5.22 dB** | — | PASSED + RGB OK |
| 128→256 | **+7.36 dB** | — | PASSED + RGB OK |

**Inference POC:** Ace favicon 16×16 → cascade 16→32→64→128→256

- Artifacts (local): `poc_out_cascade/` , `poc_cascade_vs_oneshot.png`
- Judge: `00_contact_sheet.png` (LR \| bilinear \| cascade \| alpha) and `05_model_alpha_restored.png`
- Compare to old soft one-shot: `poc_out/05_model_alpha_restored.png` vs cascade sheet

Models on disk: `assets/models_cascade/*.tflite` (not yet swapped into app `assets/models/`).



### Hybrid bilin + one-shot composite (2026-08-08)

User observation: bilin fuller/blurrier; one-shot sharper/thinner. Proposed layering
one-shot on bilin and cutting bilin halo — implemented as inference POC (no retrain).

Script: `scripts/poc_hybrid_composite.py`  
Artifacts: `poc_out_hybrid/`

| Variant | Idea |
| ------- | ---- |
| A freq | lowpass(bilin) + highpass(model) |
| B mask | model silhouette + bilin hole fill; bg outside mask |
| C clamp | bilin + clamp(model−bilin) (limit fill carve) |
| combo | A then B |

Also **hybrid cascade from 16px** (×2 hops): each hop bilin+model→hybrid→next, using cascade v2 models. Color stays near bilin (no v1 gray wash); dark% ~0–1%.

Judge: `poc_out_hybrid/00_contact_single_hop.png`, `00_contact_cascade_hybrid.png`.


## Changelog

| Date       | Change                                                                        |
| ---------- | ----------------------------------------------------------------------------- |
| 2026-08-05 | Initial TRAINING_FIXES (5 commits, loss/val/OOM)                              |
| 2026-08-06 | GPU memory / isolate / multi-GPU notes → TRAINING_GPU_MEMORY.md               |
| 2026-08-07 | Residual FSRCNN fix; hard-sample PSNR gate; Ace POC slightly > bicubic        |
| 2026-08-08 | Research dump; cascade + edge loss + degradations strategy; methods inventory |
| 2026-08-08 | Cascade POC trained on VPS: all 4 hops PASS (+2.4…+7.4 dB); Ace contact sheet ready |

