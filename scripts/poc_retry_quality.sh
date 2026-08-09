#!/usr/bin/env bash
# Retry the 4 quality-gate fails with FULL MODEL_CONFIGS epochs (no --epochs override).
# Loss formula unchanged. Writes into assets/models_poc_batch/
set -u
set -o pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${POC_OUT_DIR:-$ROOT/assets/models_poc_batch}"
LOG_DIR="${POC_LOG_DIR:-$ROOT/training_logs}"
LOG="$LOG_DIR/poc_retry_quality.log"
mkdir -p "$OUT_DIR" "$LOG_DIR"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PY="$ROOT/.venv/bin/python"
elif [[ -x "$ROOT/venv/bin/python" ]]; then
  PY="$ROOT/venv/bin/python"
else
  PY="${PYTHON:-python3}"
fi

export USE_MULTI_GPU="${USE_MULTI_GPU:-true}"
export TRAIN_ISOLATE="${TRAIN_ISOLATE:-true}"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# No --epochs= → trainer uses MODEL_CONFIGS full recipe
run_one() {
  local family="$1"
  local model="$2"
  local script
  if [[ "$family" == "espcn" ]]; then
    script="$ROOT/scripts/train_espcn_multi.py"
  else
    script="$ROOT/scripts/train_fsrcnn_multi.py"
  fi
  echo "" | tee -a "$LOG"
  echo "======== $(ts) $family $model FULL_EPOCHS ========" | tee -a "$LOG"
  set +e
  "$PY" -u "$script" --force --model="$model" --output-dir="$OUT_DIR" 2>&1 | tee -a "$LOG"
  local rc=${PIPESTATUS[0]}
  set -e
  echo "======== $(ts) $family $model rc=$rc ========" | tee -a "$LOG"
  return "$rc"
}

echo "POC quality retry start $(ts)" | tee "$LOG"
echo "python=$PY out=$OUT_DIR (full epochs, same loss)" | tee -a "$LOG"

FAIL=0
# Config epochs: 16→64 = 4x → 120; 16→128 = 8x → 300; 16→192 = 12x → 350
run_one espcn 16_64 || FAIL=$((FAIL + 1))
run_one espcn 16_128 || FAIL=$((FAIL + 1))
run_one fsrcnn 16_192 || FAIL=$((FAIL + 1))
run_one fsrcnn 16_128 || FAIL=$((FAIL + 1))

echo "" | tee -a "$LOG"
echo "POC quality retry done failures=$FAIL $(ts)" | tee -a "$LOG"
ls -la "$OUT_DIR"/*.tflite 2>&1 | tee -a "$LOG"
exit "$FAIL"
