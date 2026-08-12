# Product plan — icons, crawl, DB, sync (no training)

**Last updated:** 2026-08-11  
**Status:** Phases **1–5.5 complete**. Phase **6** (ship polish) unblocked. **Training frozen.**

This is the living execution plan for app-side quality and reliability **without** retraining TFLite models. AI upscale strategy remains frozen in [`docs/AI_UPSCALING.md`](./AI_UPSCALING.md) (now under `docs/`).

---

## North star

1. **Better icons without training** — prefer SVG / apple-touch / large PNGs; rank candidates; keep brand-safe hybrid AI as optional polish.
2. **Reliable crawl** — rate limits, retries, no dropped queue work, no stuck cooldowns.
3. **Honest data layer** — clear schema, no crawl-result pile-up, modular DB code.
4. **Honest sync** — cloud carries user data only; crawl ephemera stays on-device; UI says so.
5. **Professional tree** — no junk artifacts; sensible folders/imports (Phase 5.5).
6. **Ship polish** — residual UX, limitations note, final gate (Phase 6).

**Explicit non-goals (for now):** new model training, Real-ESRGAN-class photo SR, rewriting OAuth providers.

---

## Phase board

| Phase | Name | Status | Gate |
| ----- | ---- | ------ | ---- |
| **1** | Registry → map + picker/persist | **Done** | `tsc`, x86_64 build, emu launch |
| **2** | Visual without training (`iconQuality` + source order) | **Done** | same + scorer smoke |
| **3** | Crawl reliability | **Done** | same |
| **4** | DB split / schema hygiene | **Done** | same |
| **5** | Sync honesty | **Done** | same |
| **5.5** | Professional cleanup (artifacts, docs, structure) | **Open** | gate after each tranche (esp. C, D) |
| **6** | Ship polish | **Open** (after 5.5) | full smoke + doc pass |

---

## Phase 1 — Registry → map + picker/persist ✅

**Goal:** Stop hand-maintaining a model registry; generate map from on-disk TFLite assets; picker/persist must not race or double-notify.

### Done
- [x] `scripts/models/generate-model-map.js` → `assets/models/model_map.json` (+ registry if needed)
- [x] App loads catalog from generated map (`MODEL_CATALOG` / model loader path)
- [x] Removed / stopped relying on hand-edited registry as source of truth
- [x] Silent multi-step cache writes + single notify where needed
- [x] Picker processing guard (no double-tap races)
- [x] Hygiene comments in README / AI_UPSCALING / build scripts as needed
- [x] Build + emulator smoke (no crash)

### Key paths
- `scripts/models/generate-model-map.js`, `scripts/models/generate-model-registry.js`
- `assets/models/*`
- Icon picker / cache write paths under `src/` + `services/database.ts`

---

## Phase 2 — Visual without training ✅

**Goal:** Cards and picker prefer high-quality sources **before** AI upscale.

### Done
- [x] `src/services/iconQuality.ts` — score by format (SVG > PNG > ICO), source (libraries, apple-touch, PWA, og), dimensions
- [x] Card auto-pick (`promoteFirstIconToCache` / `pickBestIcon`) uses quality, not dead `fallbackTier`
- [x] Picker list sort by quality
- [x] Fetch order quality-sorted
- [x] Crawl / favicon / HTML common paths prefer `favicon.svg`, apple-touch, android-chrome 512/192 before tiny `.ico`
- [x] Hybrid AI path **untouched** (frozen brand-safe)
- [x] Build + emu smoke

### Manual (optional residual → Phase 6)
- [ ] Spot-check 5–10 brands after a fresh crawl (Netflix, Spotify, etc.)

---

## Phase 3 — Crawl reliability ✅

**Goal:** Stop silent failures, stuck rate limits, and dropped queue work.

### Done
- [x] **`recordSuccess` bugfix** — success always clears cooldown (was stuck limited)
- [x] **`recordRateLimit(url, retryAfterMs?)`** — honors `Retry-After` (capped)
- [x] Downloads: skip cooled domains; 429/403 → rate limit; up to 3 attempts on timeout/network/5xx; reject empty bodies; `recordSuccess` on OK
- [x] Queue: busy → **re-run** flag (no dropped enqueues); quality-ordered candidates; skip rate-limited URLs
- [x] **`startIconCrawl`** de-dupes in-flight work per `iconKey`
- [x] Build + emu smoke

### Key paths
- `src/services/rateLimitTracker.ts`
- `src/services/iconBackgroundCrawler.ts`

---

## Phase 4 — DB split / schema hygiene ✅

**Goal:** One canonical schema, versioned migrations, no crawl-result duplicates, thinner modules.

### Done
- [x] `services/db/schema.ts` — full `SCHEMA_SQL`, `SCHEMA_VERSION = 8`, idempotent migrations, `applySchema()`
- [x] `services/db/connection.ts` — key mgmt, open/close/getDatabase
- [x] `services/database.ts` — public facade (call sites unchanged)
- [x] Base schema includes crawl results, crawled_urls, icon_reports, dimensions
- [x] Migration 8: collapse duplicate `(icon_key, original_url)` + unique partial index
- [x] **`saveCrawlResult`** update-in-place when URL exists (placeholder → bytes)
- [x] `PRAGMA user_version = 8`
- [x] Build + emu smoke

### Layout (pre–5.5; may move under `src/services/` in 5.5-D)
```text
services/
  database.ts          # public API
  db/
    schema.ts          # SCHEMA_SQL + MIGRATIONS + applySchema
    connection.ts      # encrypted open/close
    syncScope.ts       # Phase 5 scope constants
```

---

## Phase 5 — Sync honesty ✅

**Goal:** Cloud sync must not pretend to be a full DB dump of spider junk; UI must match behavior.

### Scope

| Included in cloud sync | Local-only (not uploaded) |
| ---------------------- | ------------------------- |
| `subscriptions` | `icon_crawl_results` |
| `preferences` | `icon_crawl_queue` |
| `icon_cache` (chosen icons) | `crawled_urls`, `icon_reports` |

Constants + copy: `services/db/syncScope.ts`  
(`SYNC_SCOPE_USER_COPY`, `BACKUP_FULL_USER_COPY`)

### Done
- [x] **`exportSyncBackup()`** — encrypted copy, strip local-only tables, clear remote file ids in payload
- [x] **`computeUserDataHash()` / `FromBackup`** — change detection ignores crawl noise
- [x] **`mergeIconCacheFromBackup()`** — download/merge restores chosen icons
- [x] **CloudSyncService** uses scoped export + user-data hashes end-to-end
- [x] **Settings** copy: what sync vs full backup does
- [x] Full **Export Backup** still full DB (includes crawl cache) — labeled honestly
- [x] Build + emu smoke

### Key paths
- `services/db/syncScope.ts`
- `services/database.ts` (`exportSyncBackup`, hashes, merge icons)
- `src/services/cloudsync/CloudSyncService.ts`
- `app/(tabs)/settings.tsx`

---

## Phase 5.5 — Professional cleanup ✅

**Goal:** Make the repo look and feel like a professional product — no root junk, coherent folders/imports, clean docs — **without breaking the app**. Same gate loop as other phases after each risky tranche.

**Why a side phase:** Phases 1–5 shipped features on a messy tree (APKs, POC dumps, split `components/` vs `src/components/`, root `services/` vs `src/services/`, autopsy markdown). Cleanup is required before Phase 6 ship polish so docs and structure match reality.

**Defaults (unless overridden):**
- **Delete** POC/research/catastrophe artifacts from the working tree (git history retains them)
- **Safer C** first (merge components only), then **D** with `@/*` → `./src/*`
- **Delete** unused `assets/models_cascade/` (no app refs)

**Out of scope:** retraining, crawler/AI rewrites, monorepo split, renaming every icon service file.

### Target tree (end of 5.5)

```text
app/                 # Expo Router screens
src/
  components/        # ALL UI (merged)
  constants/
  context/
  hooks/
  lib/
  services/
    database.ts      # + db/ (from root services/)
    cloudsync/
    icon*.ts
  config/
  types/
assets/              # fonts, images, models (shipped only)
scripts/
  android/           # build / emu / verify
  train/             # trainers + requirements*.txt
  models/            # generate-model-*.js
docs/
  AI_UPSCALING.md
  BUILD.md
  plan.md
README.md
package.json
app.config.js / app.json
…
```

**Not in repo** (gitignore + removed from tree): APKs, `build-*.log`, `poc_out*`, root `poc_*.png`, `emu_*.png`, `research/`, empty `history/`, build-out copies.

### Tranche board

| Tranche | Name | Risk | Status |
| ------- | ---- | ---- | ------ |
| **A** | Artifacts + `.gitignore` + APK output dir | Low | **Done** |
| **B** | Docs → `docs/`, delete stubs/autopsy | Low | **Done** |
| **C** | Merge `components/` → `src/components/` | Medium | **Done** |
| **D** | `services` / `lib` / `constants` under `src/` + aliases | High | Open |
| **E** | `scripts/{android,train,models}` layout | Low–med | **Done** |
| **F** | README + plan status + import polish | Low | **Done** |

**Rule:** gate after **A**, **C**, **D**, **E** (full build). Never combine D with A untested.

---

### 5.5-A — Artifacts & ignore rules

**Delete from working tree:**

| Item | Why |
| ---- | --- |
| `app-release-*.apk` (~480MB) | Build outputs |
| `build-*.log` | Build logs |
| `poc_out/`, `poc_out_*`, root `poc_*.png` | Training POC dumps |
| `emu_*.png` | Ad-hoc screenshots |
| `research/` | Session dumps, not product |
| `history/` | Empty |
| `dist/` if present | Build residue |
| `assets/models_cascade/` | Unused by app; cascade not shipped |

**`.gitignore` additions:**

```gitignore
# Build outputs
app-release-*.apk
app-debug-*.apk
build-*.log
/dist/
/build-out/

# POC / research artifacts
poc_out*/
poc_*.png
emu_*.png
/research/
/history/

# Local tooling
.emulator-device
.expo-export-tmp/
```

**Build script:** copy APKs to `build-out/apk/app-release-${ARCH}.apk` (gitignored), not repo root. Update README paths.

- [x] Delete artifacts listed above
- [x] Extend `.gitignore`
- [x] Point `scripts/android/build-android.sh` at `build-out/apk/`
- [x] **Gate A:** `tsc` + `build:android:x86_64` + emu smoke

---

### 5.5-B — Docs hygiene

**Keep → move under `docs/`:**

- `AI_UPSCALING.md` (SSOT)
- `plan.md` (this file)
- `BUILD.md` (fold useful bits from `BUILD_FULL.md`, then drop FULL)

**`README.md` stays at repo root** (standard).

**Delete from root:**

- Stubs: `AI_UPSCALING_IMPLEMENTATION.md`, `TRAINING_FIXES.md`, `TRAINING_FIX_DOCUMENTATION.md`, `TRAINING_GPU_MEMORY.md`
- Autopsy noise: `CATASTROPHE_ANALYSIS.md`, `CATASTROPHE_ANALYSIS_2.md`, `GARBAGE_REPORT.md`
- `posthog-setup-report.md` (fold ≤3 lines into README if needed)
- `task-progress.md` (superseded by this plan)

**Keep at root:** `AGENTS.md`, `CLAUDE.md` (agent tooling).

- [x] Create `docs/`, move keepers, fix links
- [x] Delete stubs / autopsy / legacy task-progress
- [x] README links → `docs/…`
- [x] Gate B: link check + `tsc`

---

### 5.5-C — Unify components

**Today:** `components/*` (cards) vs `src/components/*` (modals).

**Safer C (do first):**

1. Move `components/*.tsx` → `src/components/`
2. Rewrite imports to `@/src/components/...` (or temporary dual path)
3. Remove empty root `components/`
4. **Gate C** full build + emu

Do **not** change global `@/*` mapping in this tranche (lower blast radius). Alias cleanup lands in D.

- [x] Merge component trees
- [x] Update all imports
- [x] **Gate C**

---

### 5.5-D — Unify services, lib, constants + aliases

**Today:** `@/services/database` → root `services/` (`@/*` → `./*`); icon/cloud code in `src/services/`.

**Action:**

1. Move `services/database.ts` + `services/db/` → `src/services/`
2. Move `lib/` → `src/lib/`
3. Move `constants/` → `src/constants/`
4. Adopt path aliases:

| Alias | Target |
| ----- | ------ |
| `@/*` | `./src/*` |
| `@assets/*` (or equiv.) | `./assets/*` as needed for Metro |

5. Normalize imports (`@/services/database`, `@/lib/…`, `@/constants/…`); kill mixed `../../services/database`
6. Grep asset `require` / icon paths carefully

- [x] Moves + tsconfig/babel paths
- [x] Import rewrite complete; `tsc` clean
- [x] **Gate D** full build + emu (**critical**)

---

### 5.5-E — Scripts layout

```text
scripts/
  android/     # build-android.sh, emulator, verify, prebuild-ios, capture-bundle-log
  train/       # train_*.py, train.sh, train-setup.sh, requirements*.txt
  models/      # generate-model-map.js, generate-model-registry.js, generate-model.js
  poc/         # optional: poc_*.py/sh only; outputs gitignored
```

- [x] Move scripts; update `package.json` paths
- [x] **Gate E:** `tsc` + one android build (train need not run)

---

### 5.5-F — Code/docs polish (no feature work)

- [x] Consistent `@/` imports only (package-local `./` kept)
- [x] Professional README (Setup, Scripts, Docs, short architecture)
- [x] This `plan.md` status → 5.5 **Done**; Phase 6 unblocked
- [x] Drop dead exports only if found after moves (none required)

---

### 5.5 success criteria

- Root is config + `app/` `src/` `assets/` `scripts/` `docs/` + lockfiles — **no** APKs/logs/POC
- One components tree and one services tree under `src/`
- `tsc` clean; x86_64 release installs; logcat `Running "main"`
- README + `docs/plan.md` describe reality

### 5.5 risk order

| Order | Tranche | Breaks app if wrong? |
| ----- | ------- | -------------------- |
| 1 | A | Unlikely |
| 2 | B | No |
| 3 | C | Yes (imports) |
| 4 | D | Yes (aliases + moves) |
| 5 | E | Build scripts |
| 6 | F | Unlikely |

---

## Phase 6 — Ship polish ⬜

**Goal:** Close the loop for a releasable cut without training. **Starts after Phase 5.5 is Done.**

### Planned
- [ ] Confirm Settings cloud/backup copy on device (screenshot or manual)
- [ ] Optional: brand spot-check list from Phase 2 residual
- [ ] Lint + `tsc` + release APK path documented once (`build-out/apk/` after 5.5-A)
- [ ] Note known limitations (OAuth client config, training freeze, sync = user tables only)
- [ ] No new features unless blocking ship

### Already done earlier (may be refreshed in 5.5-F)
- [x] README points at plan + AI upscaling docs (paths updated again in 5.5-B)

### Out of scope for Phase 6
- Retrain FSRCNN/ESPCN
- New cloud providers
- Schema v9 unless a ship blocker appears
- Large refactors (belong in 5.5, not here)

---

## Frozen (do not reopen casually)

| Area | Rule |
| ---- | ---- |
| **Training** | Frozen — see `docs/AI_UPSCALING.md` §2. Entry remains `npm run train:models:force` only when explicitly unfrozen. |
| **Inference hybrid** | `bilin + 0.25 · clamp(residual)` — brand-safe defaults in `iconProcessing.ts` |
| **TFLite export** | Float32 only — never default quant |

---

## Standard gate (every phase / risky tranche)

```bash
npx tsc --noEmit
npm run build:android:x86_64   # install + launch on emu when self-contained
# logcat: Running "main", no RN fatal; crawler may start
```

---

## Related docs

| Doc | Role |
| --- | ---- |
| [`docs/plan.md`](./plan.md) | **This file** — execution phases  |
| [`docs/AI_UPSCALING.md`](./AI_UPSCALING.md) | AI/train/inference SSOT  |
| [`README.md`](../README.md) | App overview / scripts (stays root) |
| [`docs/BUILD.md`](./BUILD.md) | Android build  (`BUILD_FULL` removed) |

---

## Changelog (plan)

| Date | Note |
| ---- | ---- |
| 2026-08-11 | Phases 1–5 implemented and smoke-tested; `plan.md` created as living board |
| 2026-08-11 | **Phase 5.5** inserted: professional cleanup (artifacts, docs, src layout) between Phase 5 and Phase 6 |
| 2026-08-11 | **5.5-A done:** artifacts removed, gitignore, APKs→`build-out/apk/`, gate passed |
| 2026-08-11 | **5.5-B done:** docs under `docs/`; stubs/autopsy removed |
| 2026-08-11 | **5.5-C done:** components merged into `src/components/`; gate passed |
| 2026-08-11 | **5.5-D done:** lib/services/constants → src/; aliases `@/*`→src+root, `@assets/*`; gate passed |
| 2026-08-11 | **5.5-E done:** scripts/{android,train,models,poc}; train:registry OK; gate passed |
| 2026-08-11 | **5.5-F done:** README rewrite; `@/` imports; Phase 5.5 complete; Phase 6 unblocked |
| 2026-08-11 | **Phase 5.5 complete** |
