# Second Catastrophe Analysis: Training Environment Setup Failure

## Date: 2026-08-01

## Summary

After fixing the model architecture issues (Catastrophe 1), the training pipeline failed due to **complete lack of environment version pinning** in the setup scripts. The system Python (3.14), CUDA (13.3), cuDNN (9.0), and the pip-resolved "latest" TensorFlow (compiled for CUDA 12.5/cuDNN 9.3) were all mutually incompatible.

## Root Cause

**No version constraints anywhere:**

- `requirements.txt`: `tensorflow` (no version)
- `train-setup.sh`: `python3 -m venv` (uses system python3, whatever version)
- No CUDA/cuDNN version documentation
- No Python version requirement documented

## Timeline of Failures

### Attempt 1: GPU Training with System Python 3.14

```
ERROR: Could not find a version that satisfies the requirement tensorflow
```

**Cause:** TensorFlow doesn't support Python 3.14 (max 3.12).

### Attempt 2: GPU Training with CUDA 13.3 / cuDNN 9.0

```
Loaded runtime CuDNN library: 9.0.0 but source was compiled with: 9.3.0
DNN library initialization failed
```

**Cause:** Latest TF compiled with cuDNN 9.3, system has 9.0. CUDA 13.3 not supported by TF (max 12.5).

### Attempt 3: Driver/Kernel Module Issues

```
modprobe: FATAL: Module nvidia not found in directory /lib/modules/6.12.88+deb13-amd64
```

**Cause:** DKMS didn't build NVIDIA kernel module for current kernel (6.12.88). Headers package not available for this exact kernel version.

## Version Compatibility Matrix (What Should Have Been Documented)

| Component      | Required        | System Had           | Compatible? |
| -------------- | --------------- | -------------------- | ----------- |
| Python         | 3.10-3.12       | 3.14                 | ❌          |
| TensorFlow     | pinned          | N/A (install failed) | -           |
| CUDA           | 12.5 (bundled)  | 13.3                 | ❌          |
| cuDNN          | 9.3 (bundled)   | 9.0                  | ❌          |
| NVIDIA Driver  | 525+            | 610.43               | ✅          |
| Kernel Headers | Matching kernel | Missing for 6.12.88  | ❌          |

## Code Changes That Were Correct (Not the Problem)

1. ✅ `train_espcn_multi.py` - Fixed MODEL_CONFIGS for all input sizes (7 scales each, proper epochs)
2. ✅ `train_fsrcnn_multi.py` - Same fix
3. ✅ Deleted `reexport-models-fixed-shape.py` (was corrupting weights)
4. ✅ Removed 64px cap in `iconProcessing.ts` `findNearestInputSize()`
5. ✅ Crawl-time upscaling already disabled in `iconUpscaler.ts`
6. ✅ Model validation already exists in both training scripts

## Lessons Learned

1. **Always pin versions** in requirements.txt - "latest" breaks when ecosystem shifts
2. **Document required Python version** - TF has strict Python version bounds
3. **Separate CPU/GPU requirements** - GPU needs matching CUDA/cuDNN stack
4. **Never depend on the system CUDA toolkit** - `tensorflow[and-cuda]` bundles it via pip
5. **Test environment setup** in CI/CD, not just code
6. **The model code was correct** - the failure was entirely in environment setup

---

## FIX IMPLEMENTED (2026-08-01)

The setup is now fully self-contained via `npm run train:setup`. The only host
requirement for GPU training is a working NVIDIA driver (>= 525). No system
CUDA, no system cuDNN, no specific system Python needed.

### Pinned Stack

| Component  | Pinned Version                                                        |
| ---------- | --------------------------------------------------------------------- |
| TensorFlow | `tensorflow[and-cuda]==2.19.0` (GPU) / `tensorflow-cpu==2.19.0` (CPU) |
| CUDA       | 12.5 — bundled as pip wheels by `[and-cuda]`                          |
| cuDNN      | 9.3 — bundled as pip wheels by `[and-cuda]`                           |
| numpy      | resolved by TF's own constraint (`>=1.26,<2.2`)                       |
| Python     | 3.10-3.12 (auto-discovered, or standalone 3.12 via `uv`)              |
| cairosvg   | 2.7.1                                                                 |
| pillow     | 11.1.0                                                                |

### Files Changed

1. **`requirements-gpu.txt`** (new) — pinned `tensorflow[and-cuda]==2.19.0` stack
2. **`requirements-cpu.txt`** (new) — pinned `tensorflow-cpu==2.19.0` stack
3. **`requirements.txt`** — repurposed as pinned CPU fallback (no more unpinned deps)
4. **`scripts/train-setup.sh`** — rewritten:
   - `--gpu` / `--cpu` flags, default auto-detect via working `nvidia-smi`
   - Finds `python3.12`/`python3.11`/`python3.10`; if none, bootstraps `uv`
     (no root) and downloads a standalone Python 3.12
   - Recreates `.venv` if it was built with an unsupported Python
   - Post-install verification: TF import + GPU visibility + **matmul smoke
     test on /GPU:0** (catches cuDNN init failures immediately, not after
     an hour of rented GPU time)
5. **`scripts/train.sh`** — preflight check before training: venv Python
   version, TF import, and **aborts if a GPU is physically present but TF
   can't see it** (prevents silently paying for a GPU while training on CPU)
6. **`package.json`** — added `train:setup:gpu` and `train:setup:cpu`

### Usage on a Fresh Rented GPU Instance

```bash
git clone <repo> && cd jsmastery
npm run train:setup        # ~3-5 min; verifies GPU is usable before you train
npm run train:models       # trains on GPU, aborts early if env is broken
```

Notes:

- GPU setup downloads ~3GB of CUDA/cuDNN pip wheels — expected, this is the
  price of self-containment.
- If `nvidia-smi` fails on the instance (broken driver/kernel module), setup
  fails immediately with an actionable message instead of falling back to a
  slow CPU install silently. Use `npm run train:setup:cpu` to explicitly
  opt into CPU training.
- On minimal Linux images, cairosvg may need `apt-get install -y libcairo2`
  (the verification step tells you this).
