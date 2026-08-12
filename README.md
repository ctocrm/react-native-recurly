# Recurly (jsmastery)

Subscription tracker for mobile — Expo Router, SQLite, optional cloud sync, and on-device TFLite icon upscaling.

**Roadmap:** [`docs/plan.md`](./docs/plan.md) (phases **1–5.5 done**; **6** ship polish next).  
**AI / training:** [`docs/AI_UPSCALING.md`](./docs/AI_UPSCALING.md)  
**Native builds:** [`docs/BUILD.md`](./docs/BUILD.md)

---

## Setup

```bash
npm install
```

Copy `.env` with Clerk (and any cloud) keys as needed. Native AI requires a **dev/release build** — not Expo Go (`react-native-fast-tflite`).

### Prerequisites (Android)

- Android SDK (`$ANDROID_HOME` / `$ANDROID_SDK_ROOT`)
- JDK 17+
- AVD (e.g. Pixel 6a API 35)

---

## Run

```bash
# Metro only (needs an existing native install that matches the project)
npm start

# Recommended local loop: build x86_64 dev client, install, watch
npm run local:start
# or with emulator snapshot cache:
npm run local:start:cache
```

---

## Scripts (common)

| Command | Purpose |
| ------- | ------- |
| `npm run build:android:x86_64` | Release APK + install on emulator |
| `npm run build:android:dev` | Dev client build |
| `npm run verify:android` | Build / install / smoke helpers |
| `npm run emulator:start` | Start configured AVD |
| `npm run train:setup` | Python venv + deps (`scripts/train/`) |
| `npm run train:registry` | Scan `assets/models/*.tflite` → registry JSON |
| `npm run train:map` | Codegen `src/services/generatedModelMap.ts` |
| `npm run train:models` | Train ESPCN + FSRCNN matrix (heavy; training frozen in plan) |

Full Android options: [`docs/BUILD.md`](./docs/BUILD.md).

---

## Layout

```text
app/                 # Expo Router screens
src/
  components/        # UI
  constants/         # theme, icons, images, seed data
  context/           # providers
  hooks/
  lib/               # utils, notifications, logos
  services/          # DB, icons, cloud sync, TFLite map
  types/
assets/              # fonts, images, models/*.tflite
scripts/
  android/           # build-android, emulator, verify
  train/             # train_*.py, requirements*.txt
  models/            # generate-model-registry / map
  poc/               # experiments (outputs gitignored)
docs/                # plan, BUILD, AI_UPSCALING
```

Path aliases (`tsconfig`): `@/*` → `src/*` (then project root), `@assets/*` → `assets/*`.

Build artifacts land under `build-out/` (gitignored).

---

## Architecture (short)

- **UI:** Expo Router + NativeWind; shared components under `src/components`.
- **Data:** SQLite via `src/services/database` + `src/services/db/*`; React context for subscriptions / icons / sync.
- **Icons:** scrape → cache → optional on-device upscale (`iconUpscaler` + bundled TFLite models).
- **Cloud:** pluggable providers under `src/services/cloudsync`.
- **Models:** registry JSON is source of truth; `train:map` regenerates the Metro `require()` map.

---

## Docs

| Doc | Contents |
| --- | -------- |
| [`docs/plan.md`](./docs/plan.md) | Phased roadmap and gates |
| [`docs/BUILD.md`](./docs/BUILD.md) | Android/iOS native build & emulator |
| [`docs/AI_UPSCALING.md`](./docs/AI_UPSCALING.md) | TFLite pipeline and training notes |

---

## License

Private / unpublished unless otherwise noted.
