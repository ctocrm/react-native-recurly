#!/usr/bin/env bash
# Larger POC: batch floor (>=2/GPU) + brand-safe loss (edge ON) before full matrix.
# Discovers class-A (crash), class-B (16->128 quality), FSRCNN never-started.
# Does NOT overwrite assets/models/ — writes assets/models_poc_batch/
set -u
set -o pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${POC_OUT_DIR:-$ROOT/assets/models_poc_batch}"
LOG_DIR="${POC_LOG_DIR:-$ROOT/training_logs}"
LOG="$LOG_DIR/poc_batch_matrix.log"
mkdir -p "$OUT_DIR" "$LOG_DIR"

if [[ -x "$ROOT/venv/bin/python" ]]; then
  PY="$ROOT/venv/bin/python"
elif [[ -x "$ROOT/.venv/bin/python" ]]; then
  PY="$ROOT/.venv/bin/python"
else
  PY="${PYTHON:-python3}"
fi

export USE_MULTI_GPU="${USE_MULTI_GPU:-true}"
export TRAIN_ISOLATE="${TRAIN_ISOLATE:-true}"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

run_one() {
  local family="$1"
  local model="$2"
  local epochs="$3"
  local script
  if [[ "$family" == "espcn" ]]; then
    script="$ROOT/scripts/train_espcn_multi.py"
  else
    script="$ROOT/scripts/train_fsrcnn_multi.py"
  fi
  echo "" | tee -a "$LOG"
  echo "======== $(ts) $family $model epochs=$epochs ========" | tee -a "$LOG"
  set +e
  "$PY" -u "$script" --force --model="$model" --epochs="$epochs" --output-dir="$OUT_DIR" 2>&1 | tee -a "$LOG"
  local rc=${PIPESTATUS[0]}
  set -e
  echo "======== $(ts) $family $model rc=$rc ========" | tee -a "$LOG"
  return "$rc"
}

echo "POC batch matrix start $(ts)" | tee "$LOG"
echo "python=$PY out=$OUT_DIR" | tee -a "$LOG"

FAIL=0

# C controls (worked in full run)
run_one espcn 16_192 50 || FAIL=$((FAIL + 1))
run_one espcn 16_64 40 || FAIL=$((FAIL + 1))

# A class — former batch=2 crashes
run_one espcn 16_512 20 || FAIL=$((FAIL + 1))
run_one espcn 128_256 20 || FAIL=$((FAIL + 1))
run_one espcn 96_288 20 || FAIL=$((FAIL + 1))
run_one espcn 256_512 15 || FAIL=$((FAIL + 1))

# B class — quality gate
run_one espcn 16_128 120 || FAIL=$((FAIL + 1))

# FSRCNN — never started in failed full run
run_one fsrcnn 16_192 50 || FAIL=$((FAIL + 1))
run_one fsrcnn 16_512 20 || FAIL=$((FAIL + 1))
run_one fsrcnn 128_256 20 || FAIL=$((FAIL + 1))
run_one fsrcnn 16_128 120 || FAIL=$((FAIL + 1))

echo "" | tee -a "$LOG"
echo "POC artifacts in $OUT_DIR:" | tee -a "$LOG"
ls -la "$OUT_DIR" 2>&1 | tee -a "$LOG"
echo "POC batch matrix done train_failures=$FAIL $(ts)" | tee -a "$LOG"
echo "Expect train log: Batch size: N (per GPU: >=2), Edge: on" | tee -a "$LOG"

# Smoke every expected POC model (missing file = FAIL)
SMOKE_OUT="${POC_SMOKE_OUT:-$ROOT/poc_out_batch_smoke}"
echo "" | tee -a "$LOG"
echo "======== $(ts) batch smoke $OUT_DIR -> $SMOKE_OUT ========" | tee -a "$LOG"
set +e
"$PY" -u "$ROOT/scripts/poc_upscale_smoke.py" \
  --batch-dir "$OUT_DIR" \
  --out "$SMOKE_OUT" \
  --expect-poc-batch 2>&1 | tee -a "$LOG"
SMOKE_RC=${PIPESTATUS[0]}
set -e
echo "======== $(ts) batch smoke rc=$SMOKE_RC ========" | tee -a "$LOG"

if [ "$SMOKE_RC" -ne 0 ]; then
  FAIL=$((FAIL + SMOKE_RC))
fi
echo "POC complete train_failures=$FAIL smoke_rc=$SMOKE_RC" | tee -a "$LOG"
echo "Review: $SMOKE_OUT/SUMMARY.txt and $SMOKE_OUT/00_all_models_strip.png"
# Non-zero if any train cell failed OR smoke failed
if [ "$FAIL" -ne 0 ] || [ "$SMOKE_RC" -ne 0 ]; then
  exit 1
fi
exit 0
