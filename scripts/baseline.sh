#!/bin/bash
# jsmastery baseline — claims-vs-reality pass, steps 1-2 (see .clinerules/02-jsmastery-local.md)
# NEVER mutates git state. Prints receipts; the agent appends the record.
set -uo pipefail
cd "$(dirname "$0")/.."
echo "=== JSD BASELINE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "--- git context (READ-ONLY) ---"
git status --short | head -10
echo "--- 1/2 typecheck ---"
npx tsc --noEmit 2>&1 | tail -3
echo "TSC_EXIT=${PIPESTATUS[0]}"
echo "--- 2/2 unit suite ---"
npx jest --silent 2>&1 | tail -8
echo "JEST_EXIT=${PIPESTATUS[0]}"
echo "--- next (agent, not script): gradlew build + emulator walkthrough of each claimed fix ---"
echo "--- record: append {claim, verdict, receipt} to docs/baselines/<date>.md ---"
