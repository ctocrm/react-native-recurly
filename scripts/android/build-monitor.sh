#!/bin/bash
# Build monitor - the "checking element"
# Runs alongside the build, polls ps every INTERVAL seconds
# Shows live status: arch, current gradle task, CPU%, process count, elapsed time
# Detects stalls (>STALL_THRESHOLD with no new task) and errors (FAILED/error:)
#
# Usage: ./scripts/build-monitor.sh <log_file> <arch> [pid_to_watch]

# No set -e: this is a long-running monitor that should not exit on transient errors
set -u

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <log_file> <arch> [pid_to_watch]" >&2
  exit 1
fi

LOG_FILE="$1"
ARCH="$2"
WATCH_PID="${3:-}"

INTERVAL=2
STALL_THRESHOLD=60
START_TIME=$(date +%s)

LAST_TASK=""
LAST_TASK_TIME=$START_TIME
ERROR_SEEN=false

get_current_task() {
    grep -oE '> Task :[^ ]+' "$LOG_FILE" 2>/dev/null | tail -1 | sed 's/> Task ://' || echo ""
}

get_cpu_pct() {
    ps -eo pcpu,comm,args 2>/dev/null | \
        grep -iE 'gradle|java|clang|kotlin' | \
        grep -v grep | \
        awk '{sum+=$1} END {printf "%.0f", sum+0}'
}

get_proc_count() {
    ps -eo comm,args 2>/dev/null | \
        grep -iE 'gradle|java|clang|kotlin' | \
        grep -v grep | \
        wc -l
}

clang_active() {
    ps -eo args 2>/dev/null | grep -E 'clang\+\+|[^ ]*clang ' | grep -v grep >/dev/null 2>&1
}

check_error() {
    if grep -qE 'FAILED|error:|What went wrong|BUILD FAILED' "$LOG_FILE" 2>/dev/null; then
        if [ "$ERROR_SEEN" = "false" ]; then
            ERROR_SEEN=true
            echo ""
            echo "[MONITOR] !!! ERROR DETECTED in build log !!!"
            echo "[MONITOR] --- last 15 lines ---"
            tail -15 "$LOG_FILE" 2>/dev/null | sed 's/^/    /'
            echo "[MONITOR] !!! Build will likely fail - check above !!!"
            echo ""
        fi
    fi
}

echo "[MONITOR] Starting monitor for arch: $ARCH"
echo "[MONITOR] Log: $LOG_FILE | Interval: ${INTERVAL}s | Stall threshold: ${STALL_THRESHOLD}s"
echo "[MONITOR] Press Ctrl+C to stop monitoring (build continues)"
echo ""

while true; do
    NOW=$(date +%s)
    ELAPSED=$((NOW - START_TIME))
    MINS=$((ELAPSED / 60))
    SECS=$((ELAPSED % 60))

    CPU=$(get_cpu_pct)
    PROCS=$(get_proc_count)
    CURRENT_TASK=$(get_current_task)

    if [ "$CURRENT_TASK" != "$LAST_TASK" ] && [ -n "$CURRENT_TASK" ]; then
        LAST_TASK="$CURRENT_TASK"
        LAST_TASK_TIME=$NOW
    fi

    TIME_SINCE_TASK=$((NOW - LAST_TASK_TIME))
    STALL_MSG=""
    if [ "$TIME_SINCE_TASK" -gt "$STALL_THRESHOLD" ]; then
        if clang_active; then
            STALL_MSG=" | NOTE: clang actively compiling (not stalled)"
        else
            STALL_MSG=" | WARNING: STALL? No new task for ${TIME_SINCE_TASK}s - no clang activity!"
        fi
    fi

    printf "\r[MONITOR] Arch: %-10s | Task: %-45s | CPU: %3s%% | Procs: %3s | Elapsed: %dm%02ds%s\033[K" \
        "$ARCH" "${CURRENT_TASK:0:45}" "$CPU" "$PROCS" "$MINS" "$SECS" "$STALL_MSG"

    check_error

    if [ -n "$WATCH_PID" ]; then
        if ! kill -0 "$WATCH_PID" 2>/dev/null; then
            echo ""
            echo "[MONITOR] Watched PID $WATCH_PID exited. Build process finished."
            break
        fi
    fi

    sleep $INTERVAL
done

echo ""
echo "[MONITOR] Monitor stopped."
