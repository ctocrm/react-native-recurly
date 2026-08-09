#!/usr/bin/env bash
# Train-only: espcn 16->128 after scale>=8 capacity bump. No smoke.
set -u
set -o pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="${POC_OUT_DIR:-$ROOT/assets/models_poc_levers}"
LOG_DIR="${POC_LOG_DIR:-$ROOT/training_logs}"
LOG="$LOG_DIR/poc_espcn_16_128_capacity.log"
mkdir -p "$OUT" "$LOG_DIR"
if [[ -x "$ROOT/.venv/bin/python" ]]; then PY="$ROOT/.venv/bin/python"
elif [[ -x "$ROOT/venv/bin/python" ]]; then PY="$ROOT/venv/bin/python"
else PY="${PYTHON:-python3}"; fi
export USE_MULTI_GPU="${USE_MULTI_GPU:-true}"
export TRAIN_ISOLATE="${TRAIN_ISOLATE:-true}"
echo "espcn 16_128 capacity retrain start $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee "$LOG"
echo "Expect: Model params >>  previous 8x toy net; LR 1.5e-4; 450 epochs" | tee -a "$LOG"
set +e
"$PY" -u "$ROOT/scripts/train_espcn_multi.py" --force --model=16_128 --output-dir="$OUT" 2>&1 | tee -a "$LOG"
rc=${PIPESTATUS[0]}
set -e
echo "done rc=$rc $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG"
ls -la "$OUT"/espcn_16x_128x.* 2>&1 | tee -a "$LOG" || true
exit "$rc"
