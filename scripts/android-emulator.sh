#!/bin/bash
# Android emulator management script
# Usage: ./scripts/android-emulator.sh <command> [device_name]
# Commands: create, delete, edit, start, stop, install, launch, logcat, status, list
#
# FLOW (per project spec):
#   create -> interactive device/API/ABI selection (or defaults when run without a
#             TTY, e.g. from the build script), downloads system image with live
#             progress, then creates the AVD. SEPARATE step from start.
#   delete -> removes an AVD by name (and clears the cache file if it matches).
#   edit   -> deletes an existing AVD then recreates it with new specs.
#   start  -> if an emulator is already running, reuse it. Otherwise launch the
#             AVD (creating one first only if none exist), then print a SINGLE
#             prompt "press ENTER when the emulator is ready" with NO timeout.
#             All emulator stdout/stderr is buffered and only flushed after the
#             user confirms ready, so it never pollutes the prompt.
#   --avd NAME     : use a specific AVD (positional arg)
#   EMULATOR_CACHE=1: cache last-used AVD to .emulator-device for reuse
#
# NOTE: This script intentionally does NOT export JAVA_HOME. JAVA_HOME is set
# only in build-android.sh to avoid the invalid "/qemu/linux-x86_64" JAVA_HOME
# regression.

set -e

ANDROID_SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/home/d/Android/Sdk}}"
APP_PACKAGE="com.ctocrm.jsmastery"
APP_ACTIVITY="com.ctocrm.jsmastery.MainActivity"
EMULATOR_LOG="$(mktemp -t emu-boot.XXXXXX.log)"
CACHE_FILE=".emulator-device"

get_emulator_serial() {
    adb devices 2>/dev/null | grep 'emulator-' | head -1 | awk '{print $1}'
}

is_emulator_running() {
    adb shell getprop sys.boot_completed 2>/dev/null | grep -q 1
}

# Returns 0 if a LIVE (non-defunct) qemu process for the given AVD is already
# alive (even if adb has not yet connected). Prevents the "multiple emulators
# same AVD" FATAL that occurs when a previous run left a background emulator
# holding the lock. Defunct/zombie qemu processes are ignored — they are stale
# leftovers from killed builds and would otherwise falsely report "alive".
is_avd_process_running() {
    local avd="$1"
    # ps selection: match the qemu cmdline for this AVD, exclude state 'Z' (zombie).
    ps -eo pid,stat,args 2>/dev/null | grep -E "qemu-system.*-avd[ =]$avd" | grep -v " Z " | grep -qv "defunct"
}

# Block until the emulator is online AND fully booted (or timeout).
# Used by the build script so it never installs/launches against an offline
# device (which would fail with "device offline").
wait_for_device() {
    local timeout_secs="${1:-120}"
    local elapsed=0
    echo "[EMULATOR] Waiting for emulator to come online (boot)..."
    while [ "$elapsed" -lt "$timeout_secs" ]; do
        local serial
        serial=$(get_emulator_serial)
        if [ -n "$serial" ]; then
            local booted
            booted=$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
            if [ "$booted" = "1" ]; then
                echo "[EMULATOR] Emulator online and booted ($serial) after ${elapsed}s."
                return 0
            fi
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    echo "[EMULATOR] WARNING: timed out waiting for emulator to boot (${timeout_secs}s)." >&2
    return 1
}

list_avds() {
    "$ANDROID_SDK/cmdline-tools/latest/bin/avdmanager" list avd 2>/dev/null | \
        grep -E "Name: " | sed 's/Name: \(.*\)/\1/' || \
        ls "$HOME/.android/avd" 2>/dev/null | sed 's/\.avd$//' || true
}

# Create an AVD. When stdin is a TTY, prompts for device/API/ABI; otherwise
# (e.g. invoked from the build script with no TTY) uses defaults so it never
# blocks. Also accepts explicit args: create_avd <device> <api> <abi>.
# Echoes the final AVD name on stdout so callers can capture it.
create_avd() {
    local device_name="pixel_6a"
    local api_level="34"
    local abi="x86_64"
    local interactive=0
    [ -t 0 ] && interactive=1

    # Allow callers to pass explicit values.
    [ -n "${1:-}" ] && device_name="$1"
    [ -n "${2:-}" ] && api_level="$2"
    [ -n "${3:-}" ] && abi="$3"

    if [ "$interactive" = "1" ] && { [ -z "${1:-}" ] || [ -z "${2:-}" ] || [ -z "${3:-}" ]; }; then
        read -r -p "[EMULATOR] Device name [$device_name]: " input
        [ -n "$input" ] && device_name="$input"
        read -r -p "[EMULATOR] API level [$api_level]: " input
        [ -n "$input" ] && api_level="$input"
        read -r -p "[EMULATOR] ABI [$abi]: " input
        [ -n "$input" ] && abi="$abi"
    fi

    local new_avd_name="${device_name}_API${api_level}"

    echo "[EMULATOR] =========================================="
    echo "[EMULATOR] CREATE ANDROID VIRTUAL DEVICE"
    echo "[EMULATOR] =========================================="
    echo "[EMULATOR] Device:  $device_name"
    echo "[EMULATOR] API:     $api_level"
    echo "[EMULATOR] ABI:     $abi"
    echo "[EMULATOR] Name:    $new_avd_name"
    echo "[EMULATOR] =========================================="
    echo ""
    echo "[EMULATOR] [1/2] Downloading system image (android-$api_level;default;$abi)..."
    echo "[EMULATOR]       This downloads ~1GB, please wait. Progress shown below."
    echo ""

    # Accept any SDK licenses non-interactively so this never hangs headless.
    yes 2>/dev/null | "$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true

    # Live progress (no silent hang). Abort cleanly on failure.
    "$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager" \
        "system-images;android-$api_level;default;$abi" 2>&1 | \
        stdbuf -oL grep -iE "download|done|installed|%" || true

    if ! "$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager" \
        --list_installed 2>/dev/null | \
        grep -q "system-images;android-$api_level;default;$abi"; then
        echo "[EMULATOR] ERROR: system image download failed. Cannot create AVD." >&2
        return 1
    fi

    echo ""
    echo "[EMULATOR] [2/2] Creating AVD '$new_avd_name'..."
    echo "no" | "$ANDROID_SDK/cmdline-tools/latest/bin/avdmanager" create avd \
        --name "$new_avd_name" --device "$device_name" \
        --package "system-images;android-$api_level;default;$abi" --abi "$abi" \
        --sdcard 4096M
    echo ""
    echo "[EMULATOR] =========================================="
    echo "[EMULATOR] AVD '$new_avd_name' CREATED SUCCESSFULLY"
    echo "[EMULATOR] =========================================="
    echo "$new_avd_name"
}

# Delete an AVD by name. Also clears cache file if it matches.
delete_avd() {
    local name="${1:-}"
    [ -z "$name" ] && { echo "[EMULATOR] Usage: delete <avd_name>" >&2; return 1; }
    echo "[EMULATOR] Deleting AVD '$name'..."
    "$ANDROID_SDK/cmdline-tools/latest/bin/avdmanager" delete avd --name "$name"
    if [ -f "$CACHE_FILE" ] && [ "$(cat "$CACHE_FILE")" = "$name" ]; then
        rm -f "$CACHE_FILE"
    fi
    echo "[EMULATOR] AVD '$name' deleted."
}

# Edit an AVD: delete it and recreate with new specs (interactive or args).
edit_avd() {
    local name="${1:-}"
    [ -z "$name" ] && { echo "[EMULATOR] Usage: edit <avd_name> [device] [api] [abi]" >&2; return 1; }
    local device_name="${2:-pixel_6a}"
    local api_level="${3:-34}"
    local abi="${4:-x86_64}"
    local interactive=0
    [ -t 0 ] && interactive=1

    if [ "$interactive" = "1" ]; then
        read -r -p "[EMULATOR] Device name [$device_name]: " input
        [ -n "$input" ] && device_name="$input"
        read -r -p "[EMULATOR] API level [$api_level]: " input
        [ -n "$input" ] && api_level="$input"
        read -r -p "[EMULATOR] ABI [$abi]: " input
        [ -n "$input" ] && abi="$abi"
    fi

    echo "[EMULATOR] Editing AVD '$name' (deleting old, creating new)..."
    delete_avd "$name"
    # Use the passed/new params; recreate with the SAME name (override device/API/ABI)
    local new_avd_name="${device_name}_API${api_level}"
    # Temporarily use the original name for recreate
    create_avd "$device_name" "$api_level" "$abi" || return 1
    # The created name might differ; user asked for edit of $name
    # Rename not supported by avdmanager; we just recreated. Inform user.
    echo "[EMULATOR] AVD '$name' recreated as '$new_avd_name' (edit = delete + create)."
}

# Resolve which AVD to use. If a specific name is given (and not "cache"), use it.
# Else if an emulator is already running or an AVD exists, pick the first.
# Else create one and return its name.
resolve_avd_name() {
    local requested_avd="$1"
    if [ -n "$requested_avd" ] && [ "$requested_avd" != "cache" ]; then
        echo "$requested_avd"
        return 0
    fi
    # Reuse cache file if present
    if [ "$requested_avd" = "cache" ] && [ -f "$CACHE_FILE" ]; then
        local cached; cached="$(cat "$CACHE_FILE")"
        if [ -n "$cached" ]; then echo "$cached"; return 0; fi
    fi
    if is_emulator_running; then
        local running; running=$(get_emulator_serial)
        if [ -n "$running" ]; then echo "$running"; return 0; fi
    fi
    local first_avd; first_avd=$(list_avds | head -1)
    if [ -n "$first_avd" ] && [ "$first_avd" != "None" ]; then
        echo "$first_avd"
        return 0
    fi
    # No AVD at all -> create (non-interactive-safe). Propagate the created name.
    create_avd
}

# Parse command and optional device name
CMD="${1:-}"
DEVICE_NAME="${2:-}"

case "$CMD" in
    create)
        existing=$(list_avds | head -1)
        if [ -n "$existing" ] && [ "$existing" != "None" ]; then
            echo "[EMULATOR] Existing AVDs found: $(list_avds | tr '\n' ' ')"
            echo "[EMULATOR] 'create' will still make a new one. Use 'start <name>' to launch an existing AVD."
        fi
        AVD_NAME=$(create_avd) || {
            echo "[EMULATOR] Create failed." >&2
            exit 1
        }
        if [ -n "$AVD_NAME" ]; then
            echo "[EMULATOR] AVD '$AVD_NAME' is ready. Use 'start $AVD_NAME' to launch it."
        fi
        ;;
    delete)
        delete_avd "$DEVICE_NAME" || exit 1
        ;;
    edit)
        edit_avd "$DEVICE_NAME" "${3:-}" "${4:-}" "${5:-}" || exit 1
        ;;
    start)
        export DISPLAY=${DISPLAY:-:0}
        if is_emulator_running; then
            SERIAL=$(get_emulator_serial)
            echo "[EMULATOR] Emulator already running (${SERIAL:-default}). Reusing it."
        else
            AVD_NAME=$(resolve_avd_name "$DEVICE_NAME")
            if [ -z "$AVD_NAME" ]; then
                echo "[EMULATOR] Error: Could not resolve or create an AVD." >&2
                exit 1
            fi
            # Guard against a zombie/background qemu still holding this AVD's
            # lock from a previous run (before adb connected). Launching a second
            # instance of the same AVD triggers a FATAL emulator error.
            if is_avd_process_running "$AVD_NAME"; then
                echo "[EMULATOR] A '$AVD_NAME' emulator process is already alive. Reusing it."
            else
                # Cache if requested or if a specific device name was given
                if [ -n "$DEVICE_NAME" ] || [ "${EMULATOR_CACHE:-0}" = "1" ]; then
                    echo "$AVD_NAME" > "$CACHE_FILE"
                fi
                # Clear any stale lock files left behind by a previously killed
                # emulator. A leftover *.lock makes the new emulator abort with
                # "exited immediately" / FATAL multi-instance errors.
                avd_dir="$HOME/.android/avd/${AVD_NAME}.avd"
                rm -f "$avd_dir"/*.lock 2>/dev/null || true
                echo "[EMULATOR] Starting $AVD_NAME..."
                # Actually launch the emulator NOW (backgrounded). Boot output is
                # buffered to a file so it does not pollute the prompt.
                "$ANDROID_SDK/emulator/emulator" -avd "$AVD_NAME" \
                    -no-snapshot-load -no-audio -gpu host -accel on \
                    > "$EMULATOR_LOG" 2>&1 &
                EMULATOR_BG_PID=$!

                # Verify the emulator process actually started (did not immediately die).
                sleep 3
                if ! kill -0 "$EMULATOR_BG_PID" 2>/dev/null; then
                    echo "[EMULATOR] ERROR: emulator process exited immediately." >&2
                    echo "[EMULATOR] ----- emulator output (buffered) -----" >&2
                    cat "$EMULATOR_LOG" 2>/dev/null >&2 || true
                    echo "[EMULATOR] ---------------------------------------" >&2
                    rm -f "$EMULATOR_LOG"
                    exit 1
                fi
                echo "[EMULATOR] Emulator process started (pid $EMULATOR_BG_PID)."

                # If running interactively (a real TTY), prompt ONCE (no timeout)
                # for the user to confirm the device UI is up. When there is no
                # TTY (e.g. invoked from the build script) the read hits EOF; we
                # must NOT let that abort the script (set -e) — just skip it.
                if [ -t 0 ]; then
                    echo ""
                    echo "[EMULATOR] =========================================="
                    echo "[EMULATOR] The emulator is now launching in the background."
                    echo "[EMULATOR] Press ENTER here ONCE the emulator has fully booted"
                    echo "[EMULATOR] (you should see the home screen / device UI)."
                    echo "[EMULATOR] =========================================="
                    read -r _ || true
                    # Flush the buffered boot log now that the user has responded.
                    echo "[EMULATOR] ----- emulator boot log (buffered) -----"
                    cat "$EMULATOR_LOG" 2>/dev/null || true
                    echo "[EMULATOR] ----------------------------------------"
                fi
                rm -f "$EMULATOR_LOG"
            fi
        fi
        ;;
    stop)
        echo "[EMULATOR] Stopping..."
        EMULATOR_SERIAL=$(get_emulator_serial)
        [ -n "$EMULATOR_SERIAL" ] && adb -s "$EMULATOR_SERIAL" emu kill 2>/dev/null || true
        echo "[EMULATOR] Stopped"
        ;;
    wait-device)
        # Optional timeout arg (seconds). Defaults to 120.
        wait_for_device "${2:-120}"
        ;;
    install)
        APK_PATH="$2"
        [ -z "$APK_PATH" ] && echo "Usage: $0 install /path/to.apk" && exit 1
        adb install -r "$APK_PATH" 2>&1 || {
            adb uninstall "$APP_PACKAGE" 2>/dev/null || true
            adb install -r "$APK_PATH"
        }
        echo "[EMULATOR] Installed"
        ;;
    launch)
        adb shell am start -n "$APP_PACKAGE/$APP_ACTIVITY" 2>/dev/null || \
            adb shell monkey -p "$APP_PACKAGE" -c android.intent.category.LAUNCHER 1
        echo "[EMULATOR] Launched"
        ;;
    logcat)
        adb logcat | grep -E "(ICON_AI|ReactNativeJS|RNTflite|jsmastery)" || true
        ;;
    status)
        is_emulator_running && echo "[EMULATOR] Running ($(get_emulator_serial))" || echo "[EMULATOR] Not running"
        ;;
    list)
        echo "[EMULATOR] Available AVDs:"
        list_avds
        ;;
    *)
        echo "Usage: $0 {create|delete|edit|start|stop|install|launch|logcat|status|list} [device_name]"
        echo "  create  - create a new AVD (interactive if TTY; defaults if no TTY)"
        echo "  delete <name> - delete an AVD by name"
        echo "  edit <name> [device] [api] [abi] - delete and recreate with new specs"
        echo "  start   - start an existing AVD (reuses running emulator; creates one only if none exist)"
        echo "  list    - list available AVDs"
        echo "  install <apk> - install APK on running emulator"
        echo "  launch  - launch the app"
        echo "  stop    - stop the running emulator"
        echo "  status  - show emulator status"
        echo "  logcat  - tail relevant logs"
        echo ""
        echo "  EMULATOR_CACHE=1 to cache the chosen AVD to $CACHE_FILE"
        echo "  Pass a device name as the 2nd arg (e.g. 'start pixel_6a_API34')"
        exit 1
        ;;
esac