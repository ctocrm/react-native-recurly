#!/bin/bash
# iOS prebuild script (requires macOS)
# Usage: ./scripts/prebuild-ios.sh
#
# Note: This script must be run on macOS with Xcode installed.
# The resulting iOS project can be built with:
#   cd ios && xcodebuild -workspace Jsmastery.xcworkspace -scheme Jsmastery -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 15' -derivedDataPath build

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "iOS Prebuild Script"
echo "=========================================="
echo ""
echo "WARNING: This platform requires macOS with Xcode."
echo ""

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo "[IOS] Error: iOS builds require macOS."
    echo "[IOS] This script can still generate the iOS project structure for reference."
    echo "[IOS] Continue? (y/n)"
    read -r response
    if [[ "$response" != "y" ]]; then
        exit 1
    fi
fi

# Step 1: Generate model (iOS uses the same model as Android)
echo "[IOS] Step 1: Model Generation"
cd "$PROJECT_ROOT"
node "$SCRIPT_DIR/generate-model.ts"

# Step 2: Prebuild iOS project
echo ""
echo "[IOS] Step 2: Expo Prebuild (iOS)"
npx expo prebuild --clean --platform ios

echo ""
echo "[IOS] Prebuild complete!"
echo ""
echo "On macOS, continue with:"
echo "  cd ios"
echo "  # Install CocoaPods if needed:"
echo "  # bundle install && bundle exec pod install --repo-update"
echo "  # Then build with Xcode or xcodebuild"