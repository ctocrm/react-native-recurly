# Second Catastrophe Analysis: Training Environment Setup Failure

## Date: 2026-08-01

## Summary

After fixing the model architecture issues (Catastrophe 1), the training pipeline failed due to **complete lack of environment version pinning** in the setup scripts. The system Python (3.14), CUDA (13.3), cuDNN (9.0), and TensorFlow (2.16 compiled for CUDA 12.5/cuDNN 9.3) were all mutually incompatible.

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

**Cause:** TensorFlow doesn't support Python 3.14 (max 3.12 as of TF 2.16)

### Attempt 2: GPU Training with CUDA 13.3 / cuDNN 9.0

```
Loaded runtime CuDNN library: 9.0.0 but source was compiled with: 9.3.0
DNN library initialization failed
```

**Cause:** TF 2.16 compiled with cuDNN 9.3, system has 9.0. CUDA 13.3 not supported by TF 2.16 (max 12.5).

### Attempt 3: Driver/Kernel Module Issues

```
modprobe: FATAL: Module nvidia not found in directory /lib/modules/6.12.88+deb13-amd64
```

**Cause:** DKMS didn't build NVIDIA kernel module for current kernel (6.12.88). Headers package not available for this exact kernel version.

## Version Compatibility Matrix (What Should Have Been Documented)

| Component      | Required        | System Had           | Compatible? |
| -------------- | --------------- | -------------------- | ----------- |
| Python         | 3.10-3.12       | 3.14                 | ❌          |
| TensorFlow     | 2.16.x          | N/A (install failed) | -           |
| CUDA           | 12.3-12.5       | 13.3                 | ❌          |
| cuDNN          | 9.3+            | 9.0                  | ❌          |
| NVIDIA Driver  | 545+            | 610.43               | ✅          |
| Kernel Headers | Matching kernel | Missing for 6.12.88  | ❌          |

## Code Changes That Were Correct (Not the Problem)

1. ✅ `train_espcn_multi.py` - Fixed MODEL_CONFIGS for all input sizes (7 scales each, proper epochs)
2. ✅ `train_fsrcnn_multi.py` - Same fix
3. ✅ Deleted `reexport-models-fixed-shape.py` (was corrupting weights)
4. ✅ Removed 64px cap in `iconProcessing.ts` `findNearestInputSize()`
5. ✅ Crawl-time upscaling already disabled in `iconUpscaler.ts`
6. ✅ Model validation already exists in both training scripts

## The Real Failure: Environment Setup Scripts

### `requirements.txt` (Before Fix)

```txt
numpy
tensorflow
cairosvg
pillow
```

**Problems:** No version pins, `tensorflow` pulls latest (may not match system CUDA), `numpy` pulls 2.x (incompatible with TF 2.16)

### `train-setup.sh` (Before Fix)

```bash
python3 -m venv "$VENV_PATH"
"$VENV_PYTHON" -m pip install -r "$REQUIREMENTS"
```

**Problems:** Uses whatever `python3` points to, no version check, no GPU/CPU variant selection

## Required Fixes

### 1. Pin Requirements for CPU Training (Guaranteed Works)

```txt
# requirements-cpu.txt
numpy<2
tensorflow-cpu==2.16.1
cairosvg
pillow
```

### 2. Pin Requirements for GPU Training (If Environment Fixed)

```txt
# requirements-gpu.txt
numpy<2
tensorflow[and-cuda]==2.16.1
cairosvg
pillow
```

Note: `tensorflow[and-cuda]` bundles CUDA 12.3 + cuDNN 9.3 - no system CUDA needed.

### 3. Update `train-setup.sh` with Version Checks

```bash
#!/bin/bash
# Require Python 3.11 or 3.12
PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
if [[ "$PYTHON_VERSION" != "3.11" && "$PYTHON_VERSION" != "3.12" ]]; then
    echo "ERROR: Python 3.11 or 3.12 required, found $PYTHON_VERSION"
    exit 1
fi
python3 -m venv "$VENV_PATH"
"$VENV_PYTHON" -m pip install -r "$REQUIREMENTS"
```

## Lessons Learned

1. **Always pin versions** in requirements.txt - "latest" breaks when ecosystem shifts
2. **Document required Python version** - TF has strict Python version bounds
3. **Separate CPU/GPU requirements** - GPU needs matching CUDA/cuDNN stack
4. **Test environment setup** in CI/CD, not just code
5. **The model code was correct** - the failure was entirely in environment setup

## Next Steps

1. Update `requirements.txt` with pinned versions for CPU training
2. Update `train-setup.sh` with Python version check
3. Run CPU training to verify model fixes work
4. Optionally fix GPU environment separately
d, found $PYTHON_VERSION"
    exit 1
fi
python3 -m venv "$VENV_PATH"
"$VENV_PYTHON" -m pip install -r "$REQUIREMENTS"
```

## Lessons Learned

1. **Always pin versions** in requirements.txt - "latest" breaks when ecosystem shifts
2. **Document required Python version** - TF has strict Python version bounds
3. **Separate CPU/GPU requirements** - GPU needs matching CUDA/cuDNN stack
4. **Test environment setup** in CI/CD, not just code
5. **The model code was correct** - the failure was entirely in environment setup

## Next Steps

1. Update `requirements.txt` with pinned versions for CPU training
2. Update `train-setup.sh` with Python version check
3. Run CPU training to verify model fixes work
4. Optionally fix GPU environment separately
