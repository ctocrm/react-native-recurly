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


3. **Degradation-matched training** (mild JPEG / resize) — not pure bicubic-only LR.
4. Prefer **larger source icons** at crawl (SVG / apple-touch) over any SR miracle from 16px.

**Caveat (learned same day):** cascade + **heavy** edge (w=0.35) + heavy degradations + multi-hop
compounding **failed brand identity** on Ace (gray wash, thinned/scribbled letters). Research still
favors progressive 2× for *sharpness metrics*; for *logos* we freeze **bilin-first hybrid + mild
training** first. Cascade routing stays on the **backburner**.

---

## Era F — Cascade → hybrid → brand-safe freeze (2026-08-08)

Single intensive session on Ace Hardware favicon (live 16×16 + Simple Icons SVG). Goal: close the
gap from “slightly better than bilin” toward user bar (~30–50% perceived). Outcome: **brand-safe
path frozen in app + trainers**; full matrix retrain in flight via `npm run train:models:force`.

### F1 — Cascade POC (metric win, visual brand fail)

**Train recipe (cascade v1, VPS 2× RTX 4000 Ada):**

- Residual FSRCNN, 2× hops: 16→32 → 32→64 → 64→128 → 128→256
- Sobel edge **w=0.35**, L1, light SSIM, **no VGG** on cascade rungs
- Heavy-ish favicon degradations (JPEG / random resize)
- Higher 2× capacity (d=64, s=16, m=8)

| Hop | Hard-sample Δ vs bicubic | Win rate | Gate |
| --- | ------------------------ | -------- | ---- |
| 16→32 | **+2.39 dB** | 79% | PASSED + RGB OK |
| 32→64 | **+4.10 dB** | 93% | PASSED + RGB OK |
| 64→128 | **+5.22 dB** | — | PASSED + RGB OK |
| 128→256 | **+7.36 dB** | — | PASSED + RGB OK |

**Artifacts:** `assets/models_cascade/*.tflite`, `poc_out_cascade/`, `poc_cascade_contact.png`,
`poc_cascade_vs_oneshot.png`.

**User visual (Ace):** cascade looked **worse for branding** than bilin / one-shot:

- Red field washed toward gray
- Letter strokes thinned / “hand-drawn” black edges (edge loss dominating)
- Multi-hop **compounded** errors (each hop fed the previous’s mistakes)

**Lesson:** PSNR/win-rate ≠ brand OK. Heavy edge + cascade is the wrong default for logos.

---

### F2 — Diagnosis & training rollback (same day)

| Cascade v1 choice | Problem | Brand-safe fix |
| ----------------- | ------- | -------------- |
| edge_weight **0.35** | Scribble edges, skeletonize fill | **0.08** mild Sobel |
| Heavy multi-hop degrade | Model invents junk structure | **Mild** LR: ~80% bicubic, rare light JPEG |
| d=64 / m=8 on 2× | Overfit edge noise | Modest capacity |
| Cascade as primary path | Error compounds | Prefer single hop + hybrid; cascade **backburner** |
| MAE alone | Soft but identity OK | Keep MAE **primary** |
| — | Red→gray | **`color_preserve_loss`** (global mean + blur L1) |
| — | Thin strokes vs bilin | **`stroke_mass_loss`** (low-pass luma + ink area) |

---

### F3 — Hybrid bilin + model (inference POC, no retrain)

**User insight:** bilin = fuller / blurrier (keeps stroke mass); model = sharper / thinner
(carves letter fill). Want model **on top of** bilin without destroying brand weight.

Script: `scripts/poc_hybrid_composite.py`  
Artifacts: `poc_out_hybrid/`, `poc_hybrid_contact.png`

| Variant | Formula / idea | Ace note |
| ------- | -------------- | -------- |
| A freq | lowpass(bilin) + highpass(model) | Can look odd / halo |
| B mask | model silhouette + bilin hole fill | Silhouette can thin |
| C clamp | bilin + clamp(model−bilin) | Better; still thins if α=1 |
| combo | A then B | Mixed |
| cascade×hybrid | hybrid each 2× hop | Color OK; still not brand-best |

Also compared **one-shot** `fsrcnn_16x_192` vs cascade hybrids.

---

### F4 — Brand-safe grid (user pick)

Extended POC: `poc_out_hybrid_brand/`, sheets `poc_brand_safe_picks.png`, `poc_brand_safe_full.png`.

| Candidate | Idea | User |
| --------- | ---- | ---- |
| bilin alone | Brand mass reference | Full weight, soft |
| clamp α=1 (full residual clamp) | bilin + clamp(Δ) | **Thins letters** |
| clamp α=0.25…0.45, small darken | Mild residual | Better than full clamp |
| edge-only residual | Highpass model only | Mixed |
| **lerp 80/20 bilin** | 0.8·bilin + 0.2·clamp_full | **Preferred band** |
| **lerp 70/30 bilin** | 0.7·bilin + 0.3·clamp_full | **Preferred band** |
| lerp 60/40 | More model | More thin risk |

**User:** variants “pretty much the same”; pick between **80/20 and 70/30**; freeze bilin-first.

**App freeze:** midpoint **t = 0.25** (75/25 equivalent via residual form):

```text
out = bilin + t * clamp(model − bilin, −max_darken, +max_brighten)
t = 0.25
max_darken = 0.12
max_brighten = 0.35
```

Equivalent to: `out = (1−t)·bilin + t·(bilin + clamp(Δ))`.

---

### F5 — Wired into production code

#### App — `src/services/iconProcessing.ts`

After successful TFLite `runSync`:

1. White-composite LR RGB (match training domain) — already present
2. Run model → `outBytes`
3. **NEW:** `bilinRgb = bilinearUpsampleRgb(rgbIn → outSize)`
4. **NEW:** `hybridRgb = brandSafeHybridRgb(bilinRgb, outBytes)`
5. NN-restore alpha; encode PNG

Constants:

- `BRAND_SAFE_LERP_T = 0.25`
- `BRAND_SAFE_MAX_DARKEN = 0.12`
- `BRAND_SAFE_MAX_BRIGHTEN = 0.35`

Log line: `[ICON_AI] brand-safe hybrid t=0.25 (bilin + clamped residual)`.

Works on **existing** tflites immediately (no retrain required for hybrid). Retrain improves the
residual so less “fight” against bilin.

#### Training — production trainers

| Script | Role |
| ------ | ---- |
| `scripts/train_fsrcnn_multi.py` | FSRCNN **sharp** production |
| `scripts/train_espcn_multi.py` | ESPCN **fast** production |
| `scripts/train_fsrcnn.py` | **Redirect** → `train_fsrcnn_multi.py` |
| `scripts/train_espcn_fast.py` | **Redirect** → `train_espcn_multi.py` |
| `scripts/train_espcn_perceptual.py` | **Redirect** → `train_espcn_multi.py` |
| `scripts/train.sh` + `npm run train:*` | Unchanged entry; calls multi trainers |

**Shared loss (both multi trainers):**

```text
loss = MAE
     + 0.10 * (MS-)SSIM
     + 0.25 * color_preserve_loss   # mean RGB + 5×5 blur L1
     + 0.20 * stroke_mass_loss      # 7×7 low-pass luma + ink area (anti-thin)
     + 0.08 * sobel_edge_loss       # mild; --no-edge to disable
     + 0.02 * VGG perceptual        # only when gate enables it
```

**Architecture (unchanged correct residual):**

```text
out = bilinear_upsample(LR) + depth_to_space(zero_init_subpixel_conv(body(LR)))
```

**LR degradation (mild / brand-safe):**

- ~80% bicubic resize HR→LR
- else area/bilinear
- ~20% light JPEG q∈[75,95]
- **Not** the cascade-v1 heavy multi-hop junk

**Validation gates (still on):** hard-sample PSNR vs bicubic; solid R/G/B color gate; float TFLite only.

---

### F6 — How to train / ship (operator)

```bash
# VPS / GPU box — full matrix overwrite with brand-safe recipe
npm run train:models:force          # both fast+sharp
# or:
npm run train:models:sharp:force
npm run train:models:fast:force

# Resume (skip existing tflites):
npm run train:models
```

Healthy log markers:

- `ColorPreserve` / `StrokeMass` / `Edge: on (w=0.08)`
- `[VALIDATE] PASSED` + RGB OK
- `[TRAIN] WROTE ...tflite`

After copy to laptop `assets/models/`:

```bash
npm run train:map                   # or generate-model-map
# rebuild + install APK as usual
```

Emulator / device check:

1. Log shows model file **and** `brand-safe hybrid t=0.25`
2. Ace (and a few logos): stroke weight ≈ bilin, slightly crisper, brand still reads
3. Not silent bilin-only fallback when model exists

**Freeze criteria:** mechanical OK + user visual OK → stop SR churn → open backburner.

---

### F7 — POC artifact index (this session)

| Path | What |
| ---- | ---- |
| `poc_out/` | Early one-shot Ace (soft > bilin) |
| `poc_out_svg/` | SVG-derived LR/HR contact |
| `poc_out_cascade/` | Cascade v1 hops contact |
| `poc_cascade_contact.png` / `poc_cascade_vs_oneshot.png` | Cascade vs one-shot |
| `poc_out_hybrid/` | Hybrid variants A/B/C/combo + cascade hybrid |
| `poc_hybrid_contact.png` | Hybrid contact |
| `poc_out_hybrid_brand/` | Brand-safe grid (lerp / clamp / edge-only) |
| `poc_brand_safe_picks.png` / `poc_brand_safe_full.png` | User pick sheets |
| `assets/models_cascade/` | Cascade tflites (not app default) |
| `scripts/poc_upscale_smoke.py` | Desktop smoke vs app path |
| `scripts/poc_hybrid_composite.py` | Hybrid / brand-safe grids |

---

### F8 — Backburner (after freeze)

1. **App cascade / multi-hop routing** using 2× matrix (only if brand-safe hybrid still not enough)
2. **Prefer larger crawl sources** (apple-touch, SVG, og:image) — highest brand ROI
3. Optional: expose lerp `t` in settings (debug)
4. Optional: drop unused extreme one-shot scales from bundle once routing is smart
5. GAN / Real-ESRGAN-class — last resort (hallucination risk on trademarks)

---

## Current frozen strategy (summary)

| Layer | Choice |
| ----- | ------ |
| **Inference** | TFLite SR → **bilin + 0.25·clamp(residual)** → alpha restore |
| **Train arch** | Residual FSRCNN/ESPCN, bilin base, zero-init subpixel |
| **Train loss** | MAE-first + color_preserve + stroke_mass + mild edge + light SSIM/VGG |
| **Train LR** | Mild degrade (bicubic-heavy, rare light JPEG) |
| **Export** | Float32 TFLite, no quant |
| **Entry** | `npm run train:models:force` |
| **Not default** | Cascade hops, edge w=0.35, heavy degrade, full model residual |

---

## Changelog

| Date | Change |
| ---- | ------ |
| 2026-08-05 | Initial TRAINING_FIXES (5 commits, loss/val/OOM) |
| 2026-08-06 | GPU memory / isolate / multi-GPU → TRAINING_GPU_MEMORY.md |
| 2026-08-07 | Residual FSRCNN fix; hard-sample PSNR gate; Ace POC slightly > bicubic |
| 2026-08-08 | Research dump; cascade + edge + degradations strategy drafted |
| 2026-08-08 | Cascade POC on VPS: hops PASS (+2.4…+7.4 dB); Ace **brand fail** (gray/thin) |
| 2026-08-08 | Hybrid bilin+model POC (freq/mask/clamp/combo); cascade×hybrid |
| 2026-08-08 | Brand-safe grid; user prefers lerp **80/20–70/30**; freeze **t=0.25** |
| 2026-08-08 | App: `brandSafeHybridRgb` in `iconProcessing.ts` |
| 2026-08-08 | Trainers: color_preserve + stroke_mass + mild edge; ESPCN aligned; legacy redirects |
| 2026-08-08 | Full matrix retrain via `npm run train:models:force` (in progress) |
| 2026-08-08 | This doc: Era F full session write-up |

---

## Quick links

| Doc / path | Topic |
| ---------- | ----- |
| `TRAINING_FIX_DOCUMENTATION.md` | Early Aug quality commits |
| `TRAINING_GPU_MEMORY.md` | VRAM, multi-GPU, isolate |
| `GARBAGE_REPORT.md` | Project autopsy |
| `CATASTROPHE_ANALYSIS*.md` | Gray/black era |
| `AI_UPSCALING_IMPLEMENTATION.md` | App AI upscale overview |
| `package.json` `train:*` | npm train entrypoints |
