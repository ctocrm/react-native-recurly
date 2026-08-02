#!/bin/bash
# Train wrapper script — runs one or both upscaling model trainers.
#
# Usage:
#   bash scripts/train.sh [--fast|--sharp|--both] [--force] [--input-size N] [--model N]
#
# Examples:
#   bash scripts/train.sh --both                          # train fast + sharp (default)
#   bash scripts/train.sh --both --force                  # force retrain both
#   bash scripts/train.sh --both --input-size 32          # both, only 32px input
#   bash scripts/train.sh --both --force --input-size 32  # force both, 32px input
#   bash scripts/train.sh --fast                          # fast only
#   bash scripts/train.sh --sharp --force --model 16_64   # sharp force, specific model

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Defaults
QUALITY="both"
FORCE=""
INPUT_SIZE=""
MODEL=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --fast)   QUALITY="fast" ; shift ;;
        --sharp)  QUALITY="sharp" ; shift ;;
        --both)   QUALITY="both" ; shift ;;
        --force)  FORCE="--force" ; shift ;;
        --input-size)
            if [ $# -lt 2 ] || [[ "$2" == --* ]]; then
                echo "[TRAIN] Error: --input-size requires a value" >&2
                exit 1
            fi
            INPUT_SIZE="$2" ; shift 2 ;;
        --model)
            if [ $# -lt 2 ] || [[ "$2" == --* ]]; then
                echo "[TRAIN] Error: --model requires a value" >&2
                exit 1
            fi
            MODEL="$2" ; shift 2 ;;
        *)        echo "[TRAIN] Unknown option: $1" ; exit 1 ;;
    esac
done

VENV_PYTHON="$PROJECT_ROOT/.venv/bin/python"
if [ ! -f "$VENV_PYTHON" ]; then
    echo "[TRAIN] Error: Python virtual environment not found at $PROJECT_ROOT/.venv"
    echo "[TRAIN] Run setup first: npm run train:setup  (bash scripts/train-setup.sh)"
    exit 1
fi

# Preflight: verify the environment BEFORE launching multi-hour training.
echo "[TRAIN] Preflight: verifying training environment..."
"$VENV_PYTHON" - <<'EOF'
import sys

version = f"{sys.version_info.major}.{sys.version_info.minor}"
if version not in ("3.10", "3.11", "3.12"):
    print(f"[TRAIN] ERROR: venv Python {version} unsupported by TensorFlow (need 3.10-3.12).", file=sys.stderr)
    print("[TRAIN] Re-run setup: npm run train:setup", file=sys.stderr)
    sys.exit(1)

try:
    import tensorflow as tf
except Exception as e:
    print(f"[TRAIN] ERROR: TensorFlow import failed: {e}", file=sys.stderr)
    print("[TRAIN] Re-run setup: npm run train:setup", file=sys.stderr)
    sys.exit(1)

gpus = tf.config.list_physical_devices("GPU")
if gpus:
    print(f"[TRAIN] TensorFlow {tf.__version__} — training on GPU: {[g.name for g in gpus]}")
else:
    import shutil
    if shutil.which("nvidia-smi"):
        print("[TRAIN] ERROR: An NVIDIA GPU is present but TensorFlow cannot see it.", file=sys.stderr)
        print("[TRAIN] You would be paying for a GPU while training on CPU. Aborting.", file=sys.stderr)
        print("[TRAIN] Fix: npm run train:setup:gpu   (installs tensorflow[and-cuda])", file=sys.stderr)
        sys.exit(1)
    print(f"[TRAIN] TensorFlow {tf.__version__} — no GPU detected, training on CPU.")
EOF

CMD_ARGS=()
[ -n "$FORCE" ]      && CMD_ARGS+=("$FORCE")
[ -n "$INPUT_SIZE" ] && CMD_ARGS+=("--input-size=$INPUT_SIZE")
[ -n "$MODEL" ]      && CMD_ARGS+=("--model=$MODEL")

run_trainer() {
    local quality="$1"
    local script_name
    if [ "$quality" = "fast" ]; then
        script_name="train_espcn_multi.py"
    else
        script_name="train_fsrcnn_multi.py"
    fi
    local script_path="$SCRIPT_DIR/$script_name"
    echo ""
    echo "=========================================="
    echo "[TRAIN] Training $quality models..."
    echo "=========================================="
    "$VENV_PYTHON" "$script_path" "${CMD_ARGS[@]}"
}

case "$QUALITY" in
    both)
        run_trainer "fast"
        run_trainer "sharp"
        ;;
    fast|sharp)
        run_trainer "$QUALITY"
        ;;
esac

# Regenerate registry from actual .tflite files
echo ""
echo "=========================================="
echo "[TRAIN] Regenerating model registry..."
echo "=========================================="
node "$SCRIPT_DIR/generate-model-registry.js"

echo ""
echo "[TRAIN] Done."
