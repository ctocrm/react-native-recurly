# Welcome to your Expo app 👋

**Roadmap:** [`docs/plan.md`](./docs/plan.md) (phases 1–5 done; **5.5** cleanup in progress; 6 ship polish). AI/train: [`docs/AI_UPSCALING.md`](./docs/AI_UPSCALING.md). Native build: [`docs/BUILD.md`](./docs/BUILD.md).

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

---

## Native Builds (EAS-free)

This project uses native Android/iOS builds instead of EAS. The AI upscaling feature requires the native `react-native-fast-tflite` module which cannot be included in Expo Go.

### Prerequisites

- **Android SDK** installed and `$ANDROID_HOME` set (point this to your local SDK installation, e.g. `~/Android/Sdk`)
- **Java JDK** 17+ installed (required for react-native-fast-tflite)
- **Android SDK Platform** 34+ installed
- **Android Emulator** with an AVD configured (e.g., Pixel_6a)

### Android Build

```bash
# Build the app (uses cached model unless source changes)
npm run build:android

# Force model regeneration and build
npm run build:android:force

# Or run the verification script directly (builds, installs, launches)
./scripts/verify-android.sh

# Force model regeneration with verification
./scripts/verify-android.sh --force-model
```

### Emulator Management

```bash
# Start emulator (waits for boot)
./scripts/android-emulator.sh start

# Install APK to emulator
./scripts/android-emulator.sh install /path/to/app-debug.apk

# Launch the app
./scripts/android-emulator.sh launch

# Monitor logs for AI module
./scripts/android-emulator.sh logcat

# Check emulator status
./scripts/android-emulator.sh status
```

### iOS Build (macOS required)

```bash
# Generate iOS project (requires macOS)
npm run prebuild:ios

# On macOS, continue with:
# cd ios
# bundle install && bundle exec pod install --repo-update
# # Then open Jsmastery.xcworkspace in Xcode or build via command line
```

### AI Icon Upscaling

The app includes on-device AI icon upscaling using a TensorFlow Lite model.

#### Models (registry → map)

On-device upscaling uses TFLite models listed in `assets/models/model_registry.json (Phase 2: crawl prefers SVG/apple-touch via iconQuality)` (source of truth).

```bash
# Refresh registry from files on disk (when models change)
node scripts/generate-model-registry.js

# Generate Metro require map + selection catalog from the registry
npm run generate-model-map
```

The Android build runs `generate-model-map` automatically. Do not hardcode model lists in app code. Training is frozen for product work.

---

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides)
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

## Docs

| Doc | Role |
| --- | ---- |
| [`docs/plan.md`](./docs/plan.md) | Execution phases (living board) |
| [`docs/AI_UPSCALING.md`](./docs/AI_UPSCALING.md) | AI train/inference SSOT (training frozen) |
| [`docs/BUILD.md`](./docs/BUILD.md) | Native Android build without EAS |

