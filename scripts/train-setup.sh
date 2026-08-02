#!/bin/bash
# Train Setup Script — fully self-contained training environment bootstrap.
#
# Creates a Python 3.12 virtual environment with a PINNED TensorFlow stack.
# GPU mode uses tensorflow[and-cuda]==2.19.0 which bundles CUDA 12.5 + cuDNN 9.3
# as pip wheels — NO system CUDA toolkit or cuDNN is needed. The only host
# requirement for GPU training is a working NVIDIA driver (>= 525).
#
# If no compatible system Python (3.10-3.12) exists, this script bootstraps
# `uv` (no root needed) and downloads a standalone Python 3.12.
#
# Usage:
#   bash scripts/train-setup.sh           # auto-detect GPU via nvidia-smi
#   bash scripts/train-setup.sh --gpu     # force GPU install (fails if no GPU)
#   bash scripts/train-setup.sh --cpu     # force CPU install
#
# Or via npm:
#   npm run train:setup
#   npm run train:setup:gpu
#   npm run train:setup:cpu
#
# After setup, train with:
#   npm run train:models          (bash scripts/train.sh --both)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENV_PATH="$PROJECT_ROOT/.venv"
VENV_PYTHON="$VENV_PATH/bin/python"

# TF 2.19 supports Python 3.9-3.12. We accept 3.10-3.12.
SUPPORTED_PY_VERSIONS=("3.12" "3.11" "3.10")
UV_PYTHON_VERSION="3.12"

MODE="auto"  # auto | gpu | cpu

while [[ $# -gt 0 ]]; do
    case "$1" in
        --gpu) MODE="gpu" ; shift ;;
        --cpu) MODE="cpu" ; shift ;;
        *) echo "[TRAIN_SETUP] Unknown option: $1" >&2 ; exit 1 ;;
    esac
done

log()  { echo "[TRAIN_SETUP] $*"; }
fail() { echo "[TRAIN_SETUP] ERROR: $*" >&2 ; exit 1; }

# ---------------------------------------------------------------------------
# 1. Decide GPU vs CPU
# ---------------------------------------------------------------------------
GPU_AVAILABLE="no"
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    GPU_AVAILABLE="yes"
    log "NVIDIA GPU detected: $(nvidia-smi --query-gpu=name,driver_version --format=csv,noheader | head -n1)"
else
    log "No working NVIDIA GPU detected (nvidia-smi missing or failed)."
fi

if [ "$MODE" = "auto" ]; then
    if [ "$GPU_AVAILABLE" = "yes" ]; then
        MODE="gpu"
    else
        MODE="cpu"
    fi
    log "Auto-detected mode: $MODE"
elif [ "$MODE" = "gpu" ] && [ "$GPU_AVAILABLE" = "no" ]; then
    fail "GPU mode requested but nvidia-smi is missing or failing.
  On a rented GPU instance this usually means the NVIDIA driver/kernel module
  is broken (e.g. 'modprobe: Module nvidia not found'). Fix the driver or use:
    bash scripts/train-setup.sh --cpu"
fi

if [ "$MODE" = "gpu" ]; then
    REQUIREMENTS="$PROJECT_ROOT/requirements-gpu.txt"
else
    REQUIREMENTS="$PROJECT_ROOT/requirements-cpu.txt"
fi
[ -f "$REQUIREMENTS" ] || fail "Requirements file not found: $REQUIREMENTS"
log "Using requirements: $(basename "$REQUIREMENTS")"

# ---------------------------------------------------------------------------
# 2. Find a compatible Python (3.10-3.12), bootstrap uv if none exists
# ---------------------------------------------------------------------------
py_version_of() {
    "$1" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true
}

is_supported_version() {
    local v="$1"
    for s in "${SUPPORTED_PY_VERSIONS[@]}"; do
        [ "$v" = "$s" ] && return 0
    done
    return 1
}

find_system_python() {
    # Prefer explicit versioned binaries, then generic python3 if it qualifies.
    for v in "${SUPPORTED_PY_VERSIONS[@]}"; do
        if command -v "python$v" >/dev/null 2>&1; then
            echo "python$v"
            return 0
        fi
    done
    if command -v python3 >/dev/null 2>&1; then
        local v
        v="$(py_version_of python3)"
        if is_supported_version "$v"; then
            echo "python3"
            return 0
        fi
    fi
    return 1
}

bootstrap_uv_python() {
    local uv_bin=""
    if command -v uv >/dev/null 2>&1; then
        uv_bin="$(command -v uv)"
    elif [ -x "$HOME/.local/bin/uv" ]; then
        uv_bin="$HOME/.local/bin/uv"
    else
        log "No compatible system Python found. Bootstrapping uv (standalone Python manager, no root needed)..."
        curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 \
            || fail "Failed to install uv. Install Python 3.12 manually and re-run."
        if [ -x "$HOME/.local/bin/uv" ]; then
            uv_bin="$HOME/.local/bin/uv"
        elif [ -x "$HOME/.cargo/bin/uv" ]; then
            uv_bin="$HOME/.cargo/bin/uv"
        else
            fail "uv installed but binary not found in ~/.local/bin or ~/.cargo/bin"
        fi
    fi
    log "Using uv at $uv_bin to install standalone Python $UV_PYTHON_VERSION..."
    "$uv_bin" python install "$UV_PYTHON_VERSION" >/dev/null
    local py_path
    py_path="$("$uv_bin" python find "$UV_PYTHON_VERSION")"
    [ -n "$py_path" ] || fail "uv could not locate Python $UV_PYTHON_VERSION after install"
    echo "$py_path"
}

PYTHON_BIN=""
if PYTHON_BIN="$(find_system_python)"; then
    log "Found compatible system Python: $PYTHON_BIN ($(py_version_of "$PYTHON_BIN"))"
else
    PYTHON_BIN="$(bootstrap_uv_python)"
    log "Using uv-managed Python: $PYTHON_BIN ($(py_version_of "$PYTHON_BIN"))"
fi

PY_VERSION="$(py_version_of "$PYTHON_BIN")"
is_supported_version "$PY_VERSION" \
    || fail "Resolved Python $PY_VERSION is not supported (need ${SUPPORTED_PY_VERSIONS[*]}). TensorFlow 2.19 does not support Python 3.13+."

# ---------------------------------------------------------------------------
# 3. Create (or recreate) the venv with the correct Python
# ---------------------------------------------------------------------------
if [ -f "$VENV_PYTHON" ]; then
    EXISTING_VERSION="$(py_version_of "$VENV_PYTHON")"
    if ! is_supported_version "$EXISTING_VERSION"; then
        log "Existing .venv uses unsupported Python $EXISTING_VERSION — recreating..."
        rm -rf "$VENV_PATH"
    else
        log "Existing .venv uses Python $EXISTING_VERSION (ok)."
    fi
fi

if [ ! -f "$VENV_PYTHON" ]; then
    log "Creating virtual environment at $VENV_PATH with $PYTHON_BIN..."
    "$PYTHON_BIN" -m venv "$VENV_PATH"
fi

# ---------------------------------------------------------------------------
# 4. Install pinned dependencies
# ---------------------------------------------------------------------------
log "Upgrading pip..."
"$VENV_PYTHON" -m pip install --upgrade pip >/dev/null

log "Installing pinned dependencies from $(basename "$REQUIREMENTS")..."
if [ "$MODE" = "gpu" ]; then
    log "(GPU mode downloads ~3GB of CUDA/cuDNN wheels — this is expected.)"
fi
"$VENV_PYTHON" -m pip install -r "$REQUIREMENTS"

# ---------------------------------------------------------------------------
# 5. Verify the installation — fail loudly BEFORE wasting GPU-instance time
# ---------------------------------------------------------------------------
log "Verifying TensorFlow installation..."
if [ "$MODE" = "gpu" ]; then
    "$VENV_PYTHON" - <<'EOF'
import sys
import tensorflow as tf
print(f"[TRAIN_SETUP] TensorFlow {tf.__version__} on Python {sys.version.split()[0]}")
gpus = tf.config.list_physical_devices("GPU")
if not gpus:
    print("[TRAIN_SETUP] ERROR: TensorFlow cannot see any GPU.", file=sys.stderr)
    print("[TRAIN_SETUP] Check: nvidia-smi works? Driver >= 525?", file=sys.stderr)
    sys.exit(1)
print(f"[TRAIN_SETUP] GPU(s) visible to TensorFlow: {[g.name for g in gpus]}")
# Smoke test: run a tiny op on the GPU to catch cuDNN/CUDA init failures now.
with tf.device("/GPU:0"):
    x = tf.random.normal((64, 64))
    y = tf.matmul(x, x)
print("[TRAIN_SETUP] GPU smoke test passed (matmul on /GPU:0).")
EOF
else
    "$VENV_PYTHON" - <<'EOF'
import sys
import tensorflow as tf
print(f"[TRAIN_SETUP] TensorFlow {tf.__version__} on Python {sys.version.split()[0]} (CPU mode)")
x = tf.random.normal((64, 64))
y = tf.matmul(x, x)
print("[TRAIN_SETUP] CPU smoke test passed.")
EOF
fi

log "Verifying cairosvg + pillow..."
"$VENV_PYTHON" -c "import cairosvg, PIL; print(f'[TRAIN_SETUP] cairosvg {cairosvg.__version__}, pillow {PIL.__version__}')" \
    || fail "cairosvg/pillow import failed. On minimal Linux images you may need: apt-get install -y libcairo2"

log "Setup complete ($MODE mode)."
echo ""
echo "[TRAIN_SETUP] To train models, run one of:"
echo "  npm run train:models          # fast + sharp"
echo "  npm run train:models:force    # force retrain everything"
echo "  bash scripts/train.sh --both --input-size 32"

# If sourced, activate the venv for the current shell
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    echo ""
    log "Activating virtual environment..."
    source "$VENV_PATH/bin/activate"
    log "Virtual environment activated. Use 'deactivate' to exit."
fi