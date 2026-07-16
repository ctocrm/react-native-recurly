#!/bin/bash
# Train Setup Script — creates a Python virtual environment with TensorFlow
# and all dependencies needed for model training.
#
# Usage:
#   bash scripts/train-setup.sh               # Creates .venv and installs deps
#   source scripts/train-setup.sh              # Same, then activates .venv
#
# This is a one-time setup. After running it, you can train models with:
#   node scripts/generate-model.js
#   node scripts/generate-model.js --force
#   node scripts/generate-model.js --quality=fast
#
# Or via npm:
#   npm run train:models
#   npm run train:models:force

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENV_PATH="$PROJECT_ROOT/.venv"
VENV_PYTHON="$VENV_PATH/bin/python"
REQUIREMENTS="$PROJECT_ROOT/requirements.txt"

echo "[TRAIN_SETUP] Setting up Python virtual environment for model training..."

# Create virtual environment if it doesn't exist
if [ ! -f "$VENV_PYTHON" ]; then
    echo "[TRAIN_SETUP] Creating virtual environment at $VENV_PATH..."
    python3 -m venv "$VENV_PATH"
    echo "[TRAIN_SETUP] Virtual environment created."
else
    echo "[TRAIN_SETUP] Virtual environment already exists at $VENV_PATH"
fi

# Install requirements
if [ -f "$REQUIREMENTS" ]; then
    echo "[TRAIN_SETUP] Installing dependencies from $REQUIREMENTS..."
    "$VENV_PYTHON" -m pip install -r "$REQUIREMENTS"
    echo "[TRAIN_SETUP] Dependencies installed."
else
    echo "[TRAIN_SETUP] No requirements.txt found at $REQUIREMENTS"
fi

echo "[TRAIN_SETUP] Setup complete."
echo ""
echo "[TRAIN_SETUP] To train models, run one of:"
echo "  node scripts/generate-model.js"
echo "  node scripts/generate-model.js --force"
echo "  node scripts/generate-model.js --quality=fast"
echo ""
echo "[TRAIN_SETUP] Or use npm:"
echo "  npm run train:models"
echo "  npm run train:models:force"
echo "  npm run train:models:fast"

# If sourced, activate the venv for the current shell
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    echo ""
    echo "[TRAIN_SETUP] Activating virtual environment..."
    source "$VENV_PATH/bin/activate"
    echo "[TRAIN_SETUP] Virtual environment activated. Use 'deactivate' to exit."
fi
