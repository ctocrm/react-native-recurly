#!/bin/bash
# Kill any process on port 8081 that may be a stray Expo/dev server.
# This is acceptable because port 8081 is the default Expo dev-server port.
lsof -ti:8081 | xargs -r kill -9 2>/dev/null
sleep 2
# Capture Expo start output to a project-relative log file.
# Uses `script` with portable invocation across Linux (script -q -c "cmd" out)
# and macOS (script out cmd). The output path is project-relative via dirname.
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/bundle.log"
if [[ "$(uname -s)" == "Darwin" ]]; then
  script "$OUT" npx expo start --clear
else
  script -q -c "npx expo start --clear" "$OUT"
fi