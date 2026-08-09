#!/usr/bin/env bash
# Re-POC with matrix-wide levers (train_levers.py). Full MODEL_CONFIGS epochs.
# Loss/hybrid unchanged. Train ONLY — no smoke.
set -u
set -o pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${POC_OUT_DIR:-$ROOT/assets/models_poc_policy}"
LOG_DIR="${POC_LOG_DIR:-$ROOT/training_logs}"
LOG="$LOG_DIR/poc_policy_matrix.log"
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
  echo "======== $(ts) $family $model FULL_LEVERS ========" | tee -a "$LOG"
  set +e
  # no --epochs= → MODEL_CONFIGS + train_levers LR/callbacks
  "$PY" -u "$script" --force --model="$model" --output-dir="$OUT_DIR" 2>&1 | tee -a "$LOG"
  local rc=${PIPESTATUS[0]}
  set -e
  echo "======== $(ts) $family $model rc=$rc ========" | tee -a "$LOG"
  return "$rc"
}

echo "POC levers matrix start $(ts)" | tee "$LOG"
echo "python=$PY out=$OUT_DIR" | tee -a "$LOG"
echo "Expect: LR policy + ESPCN scale>=8 capacity (64ch/2map on 8x) + full epochs. NO SMOKE." | tee -a "$LOG"

FAIL=0
# Same cell set as batch POC — full epochs under new levers
run_one espcn 16_192 || FAIL=$((FAIL + 1))
run_one espcn 16_64 || FAIL=$((FAIL + 1))
run_one espcn 16_512 || FAIL=$((FAIL + 1))
run_one espcn 128_256 || FAIL=$((FAIL + 1))
run_one espcn 96_288 || FAIL=$((FAIL + 1))
run_one espcn 256_512 || FAIL=$((FAIL + 1))
run_one espcn 16_128 || FAIL=$((FAIL + 1))
run_one fsrcnn 16_192 || FAIL=$((FAIL + 1))
run_one fsrcnn 16_512 || FAIL=$((FAIL + 1))
run_one fsrcnn 128_256 || FAIL=$((FAIL + 1))
run_one fsrcnn 16_128 || FAIL=$((FAIL + 1))

echo "" | tee -a "$LOG"
echo "POC levers matrix done train_failures=$FAIL $(ts)" | tee -a "$LOG"
ls -la "$OUT_DIR"/*.tflite 2>&1 | tee -a "$LOG" || true
echo "NO SMOKE — report train results first" | tee -a "$LOG"
exit "$FAIL"
