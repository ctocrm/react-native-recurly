# Product plan — icons, crawl, DB, sync (no training)

**Last updated:** 2026-08-18

**Status:** Phases **1–5.5 complete**. **MAJOR FIX (Tranches A–F) complete on-device.** **UI Improvements Phase 0–3 complete** (`ba66478`, `e4e383e`, `77a83bb`, `913b08f`). Next is Phase 4 (email account scan), then Phase 5 (subscription dependency graph). Phase 6 remains later ship polish. Training frozen.

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

| Phase   | Name                                                   | Status                    | Gate                                |
| ------- | ------------------------------------------------------ | ------------------------- | ----------------------------------- |
| **1**   | Registry → map + picker/persist                        | **Done**                  | `tsc`, x86_64 build, emu launch     |
| **2**   | Visual without training (`iconQuality` + source order) | **Done**                  | same + scorer smoke                 |
| **3**   | Crawl reliability                                      | **Done**                  | same                                |
| **4**   | DB split / schema hygiene                              | **Done**                  | same                                |
| **5**   | Sync honesty                                           | **Done**                  | same                                |
| **5.5** | Professional cleanup (artifacts, docs, structure)      | **Done**                  | complete                            |
| **MF**  | Icon crawler → picker → upscale pipeline recovery      | **Done (A–F on-device)**  | full cross-layer gate every tranche |
| **UI**  | Post-Major-Fix UI improvements                         | **Phases 0–3 done**       | skill loop after Phase 0            |
| **6**   | Ship polish                                            | **After UI Improvements** | full smoke + doc pass               |

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

| Included in cloud sync      | Local-only (not uploaded)      |
| --------------------------- | ------------------------------ |
| `subscriptions`             | `icon_crawl_results`           |
| `preferences`               | `icon_crawl_queue`             |
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

| Tranche | Name                                                    | Risk    | Status   |
| ------- | ------------------------------------------------------- | ------- | -------- |
| **A**   | Artifacts + `.gitignore` + APK output dir               | Low     | **Done** |
| **B**   | Docs → `docs/`, delete stubs/autopsy                    | Low     | **Done** |
| **C**   | Merge `components/` → `src/components/`                 | Medium  | **Done** |
| **D**   | `services` / `lib` / `constants` under `src/` + aliases | High    | Open     |
| **E**   | `scripts/{android,train,models}` layout                 | Low–med | **Done** |
| **F**   | README + plan status + import polish                    | Low     | **Done** |

**Rule:** gate after **A**, **C**, **D**, **E** (full build). Never combine D with A untested.

---

### 5.5-A — Artifacts & ignore rules

**Delete from working tree:**

| Item                                      | Why                                |
| ----------------------------------------- | ---------------------------------- |
| `app-release-*.apk` (~480MB)              | Build outputs                      |
| `build-*.log`                             | Build logs                         |
| `poc_out/`, `poc_out_*`, root `poc_*.png` | Training POC dumps                 |
| `emu_*.png`                               | Ad-hoc screenshots                 |
| `research/`                               | Session dumps, not product         |
| `history/`                                | Empty                              |
| `dist/` if present                        | Build residue                      |
| `assets/models_cascade/`                  | Unused by app; cascade not shipped |

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

| Alias                   | Target                           |
| ----------------------- | -------------------------------- |
| `@/*`                   | `./src/*`                        |
| `@assets/*` (or equiv.) | `./assets/*` as needed for Metro |

1. Normalize imports (`@/services/database`, `@/lib/…`, `@/constants/…`); kill mixed `../../services/database`
2. Grep asset `require` / icon paths carefully

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

| Order | Tranche | Breaks app if wrong?  |
| ----- | ------- | --------------------- |
| 1     | A       | Unlikely              |
| 2     | B       | No                    |
| 3     | C       | Yes (imports)         |
| 4     | D       | Yes (aliases + moves) |
| 5     | E       | Build scripts         |
| 6     | F       | Unlikely              |

---

## MAJOR FIX — Icon crawler → picker → upscale pipeline recovery ✅

**Status:** **Done (Tranches A–F on-device, 2026-08-14).** Frozen contracts still apply to later UI work. Phase 6 ship polish waits on UI Improvements.

**Why this is a major fix:** crawler discovery, picker behavior, card/cache state, and upscaling are one coupled icon pipeline. Project history repeatedly fixed one layer while breaking another, then continued forward and recreated the same failures. This repair is not complete when search returns URLs, when images download, when TypeScript passes, or when the app builds. It is complete only when the full user-facing icon pipeline works end-to-end without regressing its downstream contracts.

### Product outcome

Given only a subscription/company name, progressively discover a small set of high-confidence, brand-correct icon/logo candidates without freezing the UI.

- Prefer official first-party assets.
- Do not show arbitrary page imagery merely to fill the picker.
- Preserve explicit user choices.
- Preserve the original source information needed by low-resolution detection and AI upscale.
- Cache successful discovery without permanently poisoning a company because a search provider was temporarily blocked.
- Prefer two trustworthy icons over twelve dubious images.
- Keep crawler quality independent from model training. **Training remains frozen.**

### Full dependency chain

Treat this as one pipeline:

```text
subscription name / iconKey
→ web discovery
→ brand/domain verification
→ downloaded ORIGINAL icon bytes
→ icon_crawl_results
→ picker candidate identity/ranking
→ low-resolution detection
→ optional AI upscale
→ AI replacement row + icon_cache
→ card rendering
→ picker reopen/reload
→ persistence across app relaunch
```

A change at one stage is not accepted until the downstream stages still satisfy their contracts.

### Historical evidence that shapes this repair

- The useful crawler architecture predates the AI-upscaling work. July history (`1b03858`, `1a7cf9c`, `aa9fead`, `d09fc10`, `36bbf19`) shows progressive improvement toward ordinary search for the official website plus first-party extraction and targeted image/dork discovery. Even the best states still admitted unrelated-image pollution, so no historical commit should be blindly restored.
- Search-provider availability and relevance are different problems. Google/image-search paths have previously produced useful discovery but also Cloudflare/429/anti-bot failures. A provider failure must not be interpreted as “this brand has no icon.”
- `9e091c1` and `3ac6928` repaired responsiveness/progressive behavior. They did **not** prove crawler search quality. Preserve that responsiveness work while repairing correctness.
- The crawler has historically admitted technically valid but unrelated images. A URL/image that downloads successfully is not proof of brand correctness.
- A particularly damaging earlier mistake was crawl-time upscaling: tiny crawled icons were converted to 256px before storage. That obscured actual source resolution, interfered with low-resolution/model selection, and helped create the upscaling rabbit hole.
- Other historical repairs got model execution working while failing to persist/display its result correctly, or introduced picker reload/cache races, blank candidates, duplicate identity problems, and UI freezes.
- Current crawl-time automatic upscaling is intentionally disabled. A crawled 16×16/32×32/64×64 raster must remain identifiable as the original low-resolution source so the picker can correctly offer optional upscale.
- Therefore crawler quality, picker behavior, cache/card behavior and upscale integration are not separable from a data-contract perspective.

### Frozen full-pipeline contracts

These invariants are locked before crawler discovery changes begin.

1. **Original-source contract**
   - Crawler persistence stores the downloaded source bytes, actual detected format and original dimensions.
   - Discovery and ranking do not mutate pixels.
   - Do not reintroduce automatic crawl-time upscaling.

2. **Candidate-identity contract**
   - A crawl candidate's stable identity derives from its source/original bytes and URL/provenance.
   - Display processing must not silently change that identity.
   - Dedupe must not merge different brands merely because a universal URL was seen elsewhere.

3. **Resolution contract**
   - `originalWidth` / `originalHeight` describe the crawled input.
   - `isLowResIcon()` and optional AI-upscale eligibility continue to use the original resolution even when display/output bytes are later transformed.

4. **Format contract**
   - Detected content wins over a misleading URL extension.
   - SVG/raster identity survives crawler → DB → picker → processing.
   - HTML/JSON/error responses are never admitted as icons merely because their URL looks image-like.

5. **Provenance contract**
   - `source` and `originalUrl` remain meaningful through selection and processing.
   - New crawler confidence/provenance data must not overload existing fields with incompatible meanings.
   - Brand confidence and visual/image quality are separate concepts.

6. **Picker contract**
   - Accepted crawl results appear progressively.
   - A refresh does not clobber already-visible good results with a transient empty collection.
   - Reported bad/broken icons remain hidden according to existing picker semantics.
   - The picker is tested through the real interaction: **long-press the subscription card icon**.

7. **Manual-selection contract**
   - Crawler activity never overwrites an icon explicitly selected by the user.

8. **Auto-promotion contract**
   - If automatic crawler promotion remains, it may replace crawler-owned/default state only.
   - It must never silently replace manual or AI-owned state.
   - Cache ownership must become explicit enough that this is enforced rather than inferred accidentally from whatever currently occupies `icon_cache`.

9. **Upscale-eligibility contract**
   - A genuine small crawled raster (for example 16/32/48px) continues to expose the Upscale action based on original dimensions.
   - SVG/high-resolution assets do not receive an inappropriate low-resolution action.

10. **AI-replacement contract**
    - AI upscale replaces the intended source candidate, persists the AI result, promotes the result to cache, and yields one coherent picker tile.
    - Never allow the old failures: source disappears with no replacement, duplicate replacement tiles, transformed output discarded in memory, or transient blank picker state.

11. **Notification/atomicity contract**
    - Multi-step AI replacement remains effectively atomic to observers.
    - Preserve silent intermediate writes plus one final notification (or an equivalently safe transaction) so the picker does not reload halfway through replacement.

12. **Card contract**
    - Selecting/upscaling changes the card to the expected persisted icon.
    - Later discovery cannot undo an explicit choice.

13. **Lifecycle contract**
    - Close picker during crawl → crawler continues.
    - Reopen picker → current/progressive candidates are available.
    - Select/upscale → close/reopen → same selected result remains.
    - Kill/relaunch → persisted choice remains.

14. **Responsiveness contract**
    - Crawling does not return to synchronous bulk JS work.
    - AI inference does not reintroduce the prior UI freeze.
    - Progressive publication and bounded/yielding work remain required.

### Target crawler architecture

The crawler repair is a staged resolver. Finding a URL, establishing the official brand domain, and accepting an icon are separate decisions.

#### 1. Resolve a trustworthy official-domain candidate

- Normalize company/brand tokens while preserving meaningful names/aliases.
- Generate a small number of deterministic domain guesses, but treat guesses as hypotheses rather than truth.
- Use ordinary web search primarily to discover website/domain candidates.
- Rank domains using brand-token agreement, search-result position, host/path evidence, and explicit penalties/denials for search engines, social networks, app stores, aggregators and unrelated third parties.
- Do not treat “first link in search HTML” as automatically official.

#### 2. Extract first-party icon evidence

Once a domain is sufficiently likely to be official, fetch that site and prioritize:

1. web-manifest icons
2. `apple-touch-icon`
3. declared `<link rel="icon">`
4. high-quality favicon/PWA paths
5. JSON-LD organization logo
6. tightly constrained logo metadata/assets with first-party or justified CDN provenance

Keep correct document-relative and manifest-relative URL resolution. Generic `<img>` crawling is not a normal candidate source; an image needs strong logo semantics and trustworthy page/domain provenance.

Open Graph, Twitter and generic JSON-LD `image` values are not automatically logos.

#### 3. Separate discovery from acceptance

Internally, crawler candidates carry evidence such as:

- requested brand
- candidate URL
- discovered/official domain
- page/referrer that vouched for the candidate
- extraction type
- provider
- brand-confidence signals
- format/dimensions when known

Before publication, validate decodability/content and brand relevance. `scoreIconQuality()` may help rank visual/source quality **after** relevance passes; it must never stand in for brand correctness.

#### 4. Rank confidence before image quality

A 512×512 random hero image is worse than a 64×64 verified official icon.

Preferred trust order:

```text
verified official manifest / apple-touch / structured logo
→ verified official favicon/PWA asset
→ strongly attributable brand asset
→ constrained image-search fallback
→ reject/withhold weak candidates
```

Low-confidence candidates do not enter the ordinary picker merely to increase candidate count.

#### 5. Keep image search as a constrained fallback

Image-search/dork providers are enrichment, not the source of truth.

- Use only after direct/official-site discovery is insufficient.
- Require meaningful attribution to the brand/confirmed domain or another strongly brand-associated source before publication.
- Reject generic aggregators, random page media and provider thumbnails without trustworthy provenance.
- Google/DDG/Bing/etc. remain best-effort; no single scraped provider is a required dependency.
- No paid API is assumed as the solution.

#### 6. Preserve progressive execution

Keep the useful responsiveness properties restored by `3ac6928`:

- stages discover progressively
- accepted candidates publish incrementally
- image processing/downloading remains bounded
- yield to the UI between expensive work
- stale/superseded work cannot publish into a newer crawl generation

#### 7. Make terminal/cache semantics truthful

Distinguish at least:

- successful crawl with useful trusted result
- exhausted/no trusted result
- transient provider/network failure
- rate-limited/deferred
- failed

Only a genuinely successful/high-confidence terminal state deserves a long success TTL. Temporary 403/429/timeouts/parser/provider failures must not poison the brand as permanently complete.

#### 8. Make diagnostics explain failures

Development diagnostics should expose enough evidence to answer:

- which domain hypotheses were generated
- what search providers returned
- which domains were rejected and why
- which pages were fetched
- which icon candidates were extracted
- which candidates were rejected and why
- confidence/quality ordering
- publication order
- rate-limit/transient failure state
- terminal crawl reason

“No icons” without diagnostic evidence is not sufficient for this recovery.

### Execution plan

Do **one tranche at a time**. Do not carry a downstream regression into the next tranche.

#### Major Fix Tranche A — Characterize and baseline before changing crawler behavior

First protect the existing downstream contracts.

- Add characterization tests/pure seams where practical for:
  - original bytes/dimensions/format
  - crawl-result persistence/update semantics
  - URL canonicalization/dedupe
  - candidate identity
  - picker ordering/visibility
  - low-resolution eligibility
  - manual/cache ownership
  - AI replacement persistence
  - report/hide behavior
  - notification behavior
  - stale generation behavior where a pure seam exists
- Use fixture tests rather than live search HTML as the unit-test oracle.
- Establish emulator characterization scenarios for behavior that genuinely requires native runtime/UI.
- Capture a current-HEAD crawler baseline **before** modifying search behavior.
- Clear crawler/discovered-icon state for fresh discovery without indiscriminately deleting explicit selected-icon state.
- Record provider failures, candidates, sources, URLs, original dimensions, wrong-image results and first-result timing.
- This tranche does **not** repair crawler discovery.

#### Major Fix Tranche B — Official-domain discovery

- Refactor search/domain discovery into provider-independent normalized domain results.
- Introduce explicit domain confidence/rejection reasoning.
- Treat provider blocked/rate-limited/transient outcomes distinctly from a successful empty search.
- Keep downstream crawl-result/picker/upscale publication contracts frozen.
- Do not combine extraction/ranking redesign into this tranche.

#### Major Fix Tranche C — First-party extraction

- Tighten HTML/manifest extraction to structured icon/brand evidence.
- Keep/fix manifest-relative and document-relative URL handling.
- Remove unconstrained generic page-image pollution.
- Add fixtures for reversed attributes, relative manifests/icons, malformed metadata, duplicates, same-site/justified CDN assets, and misleading `logo`/`icon` URLs.
- Keep the downstream publication contract unchanged.

#### Major Fix Tranche D — Provenance-aware acceptance and ranking

- Carry provenance/evidence through the internal crawler pipeline.
- Gate publication on brand confidence.
- Apply visual/source quality only after relevance.
- Canonicalize/dedupe candidates without losing brand ownership.
- Preserve original source bytes and metadata.
- Continue progressive publication.
- Do not change AI models/training.

#### Major Fix Tranche E — Resilience, terminal state and cache ownership

- Add/finish stale-generation cancellation around network and publication stages.
- Bound concurrency and retries without monopolizing JS.
- Implement truthful transient/rate-limited/exhausted/success terminal semantics.
- Prevent transient provider failure from becoming a long-lived “complete.”
- Make cache ownership explicit enough that crawler auto-promotion cannot overwrite manual/AI choices.
- If persistence/schema changes are necessary, isolate them in a versioned migration with compatibility characterization; do not bundle them invisibly into search changes.

#### Major Fix Tranche F — Full end-to-end acceptance

Build/install/launch and validate the complete pipeline with at least these eight real subscriptions:

1. Netflix
2. Spotify
3. GitHub
4. Linear
5. 1Password
6. Miro
7. Toggl Track
8. Backblaze

This deliberately includes common and uncommon/ambiguous brands. Do not hard-code behavior around the test list.

For representative low-resolution results also exercise:

```text
fresh crawl
→ candidate appears progressively
→ long-press card icon
→ picker shows correct candidate
→ original dimensions make Upscale eligible
→ run AI upscale
→ AI result appears/persists as one coherent tile
→ card uses expected result
→ close/reopen picker
→ relaunch app
→ persisted result remains
```

Also:

- manually select a candidate, run/re-run crawler, prove the manual choice remains selected
- verify SVG/high-resolution candidates are not incorrectly treated as low-resolution
- close/reopen picker during an active crawl and prove background/progressive behavior survives
- verify reports continue hiding incorrect/broken candidates
- inspect crawler/network diagnostics for provider failures and queue state

### Mandatory regression gate after every implementation tranche

Every crawler implementation tranche must pass the cross-layer gate before work continues:

```text
relevant characterization tests + tsc + lint
→ Android build/install/launch
→ crawler discovery smoke
→ long-press picker smoke
→ selection/card persistence smoke
→ low-resolution/upscale integration smoke
→ picker reopen/relaunch smoke where applicable
```

A static pass or successful build is not enough.

If a tranche produces any form of:

```text
crawler fixed, picker broken
picker fixed, upscale broken
upscale fixed, crawler broken
```

**STOP.** Repair or revert that tranche before moving on.

The project must not accumulate cross-layer breakage and continue forward again.

### Major Fix acceptance contract

Crawler quality is **precision-first**.

- 8/8 test subscriptions finish without UI freeze or React Native fatal.
- Target 8/8 with at least one clearly brand-correct discovered candidate; minimum acceptance is 7/8 with a diagnosable miss rather than a random substitute.
- **0 wrong-brand/random-content candidates presented in the ordinary picker across the validation set.**
- First accepted candidate appears progressively rather than only after the entire crawl.
- A temporary search/provider failure does not permanently poison the brand as complete.
- Canonically identical URLs do not produce duplicate candidates.
- Stale crawl generations cannot publish after refresh/supersession.
- Explicit manual selection survives later crawling.
- Original low-resolution metadata survives discovery and correctly enables optional upscale.
- AI-upscaled output is persisted, presented once, reflected on the card, survives picker reopen and app relaunch.
- SVG/high-resolution inputs do not receive inappropriate low-resolution treatment.
- TypeScript, lint/relevant characterization tests, Android build, install/launch, and actual user reproduction all pass.

A technically valid/downloadable image that is not the intended brand is a **failure**, not a partial success.

### Hard non-goals and safeguards

- **No model retraining. Training remains frozen.**
- Do not modify model/training files as part of crawler recovery.
- Do not recommend paid compute or paid search APIs to compensate for unproven crawler logic.
- Do not restore a historical crawler commit wholesale; history provides evidence and useful mechanisms, not a proven drop-in solution.
- Do not conflate responsiveness with crawler correctness.
- Do not conflate image resolution/quality with brand correctness.
- Do not reopen the frozen inference/model strategy while repairing discovery.
- One root problem/tranche at a time.
- Apply the project three-strike safeguard: after three failed implementation attempts against the same root issue, stop, preserve evidence, give the user a detailed resume, agree on a materially different approach, update this plan, commit it, then resume.

### Major Fix completion rule

Do not mark this section complete, unblock Phase 6, or describe the crawler as fixed until the full end-to-end acceptance contract above has been demonstrated on emulator/device.

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

| Area                 | Rule                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Training**         | Frozen — see `docs/AI_UPSCALING.md` §2. Entry remains `npm run train:models:force` only when explicitly unfrozen. |
| **Inference hybrid** | `bilin + 0.25 · clamp(residual)` — brand-safe defaults in `iconProcessing.ts`                                     |
| **TFLite export**    | Float32 only — never default quant                                                                                |

---

## Standard gate (every phase / risky tranche)

```bash
npx tsc --noEmit
npm run build:android:x86_64   # install + launch on emu when self-contained
# logcat: Running "main", no RN fatal; crawler may start
```

---

## Related docs

| Doc                                         | Role                                 |
| ------------------------------------------- | ------------------------------------ |
| [`docs/plan.md`](./plan.md)                 | **This file** — execution phases     |
| [`docs/AI_UPSCALING.md`](./AI_UPSCALING.md) | AI/train/inference SSOT              |
| [`README.md`](../README.md)                 | App overview / scripts (stays root)  |
| [`docs/BUILD.md`](./BUILD.md)               | Android build (`BUILD_FULL` removed) |

---

## UI Improvements — post-Major-Fix (2026-08-14)

**Status:** Phases 0–3 complete (`ba66478`, `e4e383e`, `77a83bb`, `913b08f`). Next is Phase 4 (email account scan), then Phase 5 (subscription dependency graph). Phase 6 ship polish stays after UI Phase 5.

Four user-requested improvements, one phase at a time. Current-code map: [`docs/CODEBASE.md`](./CODEBASE.md). Visual gates use [`.cline/skills/emulator-ui-driving/SKILL.md`](../.cline/skills/emulator-ui-driving/SKILL.md).

### Why Phase 0 exists

The predecessor claimed Phase 0 done after commit `56bd161`. That commit only appended a thin stub, an 83-line overview, and a skill rewrite. The Phase 0 boxes were still unchecked. A “full current-codebase overview” and a Major-Fix-style plan with per-task programmatic **and** visual gates were not actually delivered. This rewrite is the real Phase 0.

### Observed product problems (evidence, not guesses)

1. **Native nav overlay / dead tap zone.** Floating tab bar is `position: "absolute"` with `bottom: Math.max(insets.bottom, 20)` and height 72 (`app/(tabs)/_layout.tsx`). Lists use `contentContainerClassName="pb-25"`, but `global.css` / `theme.ts` spacing jumps **24 → 30** — there is **no `--spacing-25`**, so that class is a no-op. Create sheet pins submit at `px-5 pb-5` (`CreateSubscriptionModal.tsx`). On-device, the Create button center sits under the Android nav; only the uncovered top slice is tappable.
2. **Subscriptions has no add control.** Home header `icons.add` opens `CreateSubscriptionModal`. `app/(tabs)/subscriptions.tsx` has search/filters/cards only.
3. **Insights chart overflows.** “Estimated Monthly Spend” is a non-scrolling `flex-row` (`insights-chart-scroll` is a class name, not a `ScrollView`). Period chips below _are_ in a `ScrollView`. 6-month / Year add more labeled bars than the card width.
4. **No email account scan.** Settings has Clerk account + cloud _file_ sync (Drive/Dropbox/…). There is no mailbox connect/scan. A subscription is an account (including $0), not only a receipt. SSO catalogs have no public client API (backburner).

### UI board

| Phase | Name                          | Status                               | Touches                                                                          | Must not touch                       |
| ----- | ----------------------------- | ------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------ |
| **0** | Docs + generic emulator skill | **Done (`ba66478`)**                 | `docs/plan.md`, `docs/CODEBASE.md`, `.cline/skills/emulator-ui-driving/SKILL.md` | App source, models, crawler          |
| **1** | Native nav overlay            | **Done (`e4e383e`)**                 | Tab list padding; Create + picker (+ shared sheets) inset padding                | Crawler, models, schema              |
| **2** | Subscriptions `+`             | **Done (`77a83bb`)**                 | `app/(tabs)/subscriptions.tsx` + existing modal wiring                           | New create flow, crawler             |
| **3** | Insights chart bounds         | **Done (`913b08f`)**                 | `app/(tabs)/insights.tsx` Estimated Monthly Spend row                            | Period-chip `ScrollView`; other tabs |
| **4** | Email account scan            | **Code landed; emulator unverified** | Settings email-scan list + mail OAuth/IMAP + scan cache                          | SSO catalogs, crawler, training      |
| **5** | Subscription dependency graph | Not started                          | Subscriptions List/Graph toggle + `dependsOn` links                              | Email scan implementation, crawler   |

### Shared gates (Phases 1–4)

**Programmatic (every implementation phase):**

```text
npx tsc --noEmit
npm test
npx expo lint          # 0 new errors
```

Then `npm run build:android:x86_64` (install + launch). Logcat: `Running "main"`, no RN fatal.

**Visual (every implementation phase), via the generic skill:**

```text
every UI-affecting adb command
→ adb exec-out screencap
→ read screenshot + vision assert
→ only then the next UI command
```

Locate targets with uiautomator bounds. Do not hardcode button coordinates in the skill or in this plan.

A static pass or a successful build is **not** a completed phase.

**Icon-pipeline smoke after any phase that rebuilds the app:** long-press a card icon still opens the picker; a selected icon still shows on the card. Do not reopen crawler search work here.

---

### Phase 0 — Documentation & generic skill (no app code, no build) ⬜

**Goal:** Agents can implement Phases 1–4 from this plan + `docs/CODEBASE.md` without rediscovering the tree. Visual gates have a generic skill before any emulator work.

#### Tasks

- [x] Append a UI-Improvements section to this file (first stub in `56bd161`).
- [x] Replace that stub with this detailed phase plan (tasks, files, programmatic + visual gates).
- [x] Rewrite `docs/CODEBASE.md` as a real current-code map (routes, padding facts, every component, providers, services, frozen contracts, build scripts).
- [x] Keep `.cline/skills/emulator-ui-driving/SKILL.md` generic:
  - YAML frontmatter `name: emulator-ui-driving` (Cline discovery).
  - Invariant: every UI-affecting adb command (`input tap/swipe/text/keyevent`, `am start/force-stop`) is followed by screencap + vision assert.
  - Generic techniques only: live `wm size`, uiautomator bounds, nav-bar dead zone, keyboard/dropdown dismissal, long-press = `input swipe X Y X Y 800`.
  - **No button-specific coordinates.**
- [x] Revert leftover Phase-1 import-only dirty diffs if present (`subscriptions.tsx`, safeguards one-liner).
- [x] Commit Phase 0 docs/skill only (`ba66478`). **Do not start Phase 1 in the same commit.**

#### Phase 0 acceptance

- This section has per-phase tasks and both gate types (not a four-bullet stub).
- `docs/CODEBASE.md` names the actual files, the `pb-25` / missing spacing-25 fact, Create-button collision, insights non-scrolling bar row, and provider nesting.
- Skill has frontmatter, the invariant, and zero hardcoded control coordinates.
- `git status` shows no accidental app-source edits from the predecessor loop.

**No build / no emulator in Phase 0.** That was an explicit user constraint.

---

### Phase 1 — Native navigation overlay ✅

**Goal:** Primary actions and list tails sit above the floating tab bar **and** the Android software nav. Create Subscription is tappable at its real center, not a leftover sliver.

#### Root cause (from code)

```text
tabBar.bottom = max(insets.bottom, 20)
tabBar.height = 72
list clearance class pb-25 → undefined token
modal submit pb-5 = 20px
```

Needed clearance is approximately `tabBar.height + max(insets.bottom, tabBar.horizontalInset)` plus a small gap — applied as **style padding**, not a missing NativeWind token.

#### Tasks

- [x] Add a single shared bottom-offset helper (or inline the same formula) from `useSafeAreaInsets()` + `components.tabBar`. Do not invent a `pb-25` token unless the theme scale is updated in the same change.
- [x] Apply it to list `contentContainerStyle` on Home, Subscriptions, Insights, Settings (replace the no-op `pb-25`).
- [x] Apply it to pinned/footer actions in `CreateSubscriptionModal` and `SubscriptionIconPickerModal`.
- [x] Apply the same inset to other sheets that share `.modal-container` / `pb-5` if their last button is similarly covered (`EditSubscriptionModal`, `SubscriptionStatsModal`, `ConfirmModal` as needed). One issue: overlay collision. Do not restyle unrelated chrome.
- [x] Do **not** start Phase 2 (`+` button) in this commit.

#### Programmatic gate

- `tsc` / `jest` / lint as above.
- Build + install + launch.

#### Visual gate (skill loop)

1. Launch app → screenshot: running UI, nav bar visible.
2. Home: scroll list to end → last card is above the tab pill, not under nav.
3. Open Create from Home `+` → screenshot: **Create Subscription** label fully visible; tap **center** of that button → modal submits / closes. A tap that only works on the top sliver is a fail.
4. Subscriptions / Insights / Settings: scroll to end → same clearance.
5. Long-press a card icon → picker sheet footer (Upscale / report chips) fully above nav; tap center of a footer control works.
6. Icon-pipeline smoke: picker still opens; no RN fatal.

---

### Phase 2 — Add-subscription `+` on Subscriptions ✅

**Goal:** Subscriptions tab can create a sub without routing back to Home.

#### Tasks

- [x] Add a header row matching Home: title + `icons.add` `Pressable`.
- [x] Wire the existing `CreateSubscriptionModal` (`visible` / `onClose` / `onCreate` → `addSubscription` from `useSubscriptions`), same as `app/(tabs)/index.tsx`.
- [x] Keep search + All/Upcoming filters.
- [x] After Phase 1, the new header must not collide with anything; the modal inherits Phase 1 inset.

#### Programmatic gate

- Same static + build gate.
- No new create-service; reuse context.

#### Visual gate (skill loop)

1. Open Subscriptions tab → screenshot: `+` visible and tappable (not under status bar / not off-screen).
2. Tap `+` → Create sheet opens.
3. Create a named sub (type name, dismiss keyboard, tap Create **center**) → sheet closes; new row is in the list.
4. Home still has its `+`; both entry points create the same kind of row.

---

### Phase 3 — Insights chart stays in bounds ✅

**Goal:** 6-month and 1-year Estimated Monthly Spend bars stay inside the card. Overflow is a fail.

#### Root cause (from code)

`app/(tabs)/insights.tsx` maps `monthlyChartData` in a `View` with `className="insights-chart-scroll flex-row items-end justify-between"`. That is **not** a `ScrollView`. Every bar has an `insights-chart-value` label. Period chips underneath already scroll.

#### Tasks

- [x] Make the **bar row** (not the period chips) a horizontal `ScrollView` inside the card.
- [x] Give each bar a fixed min-width so 6/12 bars do not squash or spill.
- [x] Condense or hide per-bar value labels when `selectedPeriod` has more than 3 points (6mo / Year).
- [x] Do not change category bars or the summary card unless they share the overflow (they should not).

#### Programmatic gate

- Same static + build gate.

#### Visual gate (skill loop)

1. Open Insights → screenshot This Month: bars inside the card border.
2. Tap `3 Months` → screenshot: still inside.
3. Tap `6 Months` → screenshot: **no bar, value, or label crosses the card border**. Horizontal scroll is allowed; overflow is not.
4. Tap `Year` → same assertion.
5. Cycle back to This Month → layout recovers.

---

### Phase 4 — Email account scan ⬜

**Goal:** Settings lists mailboxes the user can connect **natively**. Scan incrementally maps **accounts** (including $0) into a cached candidate set. The user reviews and imports. Connect without a working `scan()` is not a product. Hollow Google/Apple SSO Connect is **not** this phase.

A **subscription is an account**, not a charge. A bill is optional evidence.

**Rule:** a branded row exists only if that provider has a documented third-party OAuth/mail API. Everything else is the last **IMAP / IMAPS** row. Do not put a fake Connect logo on iCloud, Proton, or Tuta.

#### Native list (branded Connect)

| Row                        | Stack                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Gmail                      | Google OAuth + Gmail API                                                                             |
| Google Workspace           | same API, work account / admin consent — **not** the same login as consumer Gmail                    |
| Outlook                    | Microsoft OAuth + Graph mail                                                                         |
| Office 365 / Microsoft 365 | same Graph stack; own row                                                                            |
| Yahoo Mail                 | Yahoo OAuth (XOAUTH2). If new-app OAuth is closed, drop the row to IMAP — do not ship a dead button. |
| AOL                        | same Yahoo/AOL identity stack                                                                        |
| Zoho Mail                  | Zoho OAuth + Mail API                                                                                |
| Fastmail                   | Fastmail OAuth + JMAP                                                                                |
| IMAP / IMAPS               | last row: iCloud, Proton, Tuta, everyone else                                                        |

Tuta IMAP may be paid/limited. If it cannot IMAP, record that. Do not add a Tuta button.

#### Architecture (toggle ≠ scan)

```text
Connect (OAuth or IMAP form)
  → incremental SCAN (network + classify + cache)
  → CACHED MAP (messages + merchant rollups)
  → DISPLAY FILTERS (recurring / sparse / free)
  → user IMPORT into subscriptions
```

- **Scan** writes the cache. First connect fetches the union of account / security / recurring-bill / sparse-bill subjects (recency + count cap). Later scans fetch only **newer than `lastCursor`**. Re-parse an old message only on a parser-version bump.
- **Toggle** only filters the cache. Flipping Recurring / Sparse / Free **does not** hit the network.
- **Import** is an explicit tap. Scan never auto-creates subscriptions.

Provider interface: `id`, `connect()`, persist in secure store, `disconnect()`, incremental `scan()`, cursor. Shared parser does not know Gmail vs IMAP.

Normalized message: `{ mailboxId, messageId, from, subject, date, text?, attachments[] }`.

Cache keys: `(mailboxId, messageId)` plus merchant rollup `(mailboxId, merchantKey)`.

#### Classify — subject first

Subject (plus From) can create a candidate. Body and attachments run **only** for money classes.

| Subject class      | Examples                                                 | Candidate?            | Body / PDF? |
| ------------------ | -------------------------------------------------------- | --------------------- | ----------- |
| **Account**        | welcome, registered, verify email, account created       | Yes → free / unknown  | No          |
| **Security**       | password reset, login alert, new device, 2FA             | Yes → merchant exists | No          |
| **Recurring bill** | subscription, renewal, membership, billed monthly/yearly | Yes                   | **Yes**     |
| **Sparse / usage** | invoice, usage, statement, IAP, order, one-off receipt   | Yes                   | **Yes**     |
| **Drop**           | newsletter, shipping-only, OTP with no account language  | No                    | No          |

**From domain** names the merchant (`noreply@github.com` → GitHub). Strip `noreply`, `billing`, `invoice`, `mail`.

**Money parse (recurring + sparse only):** prefer `text/plain`, else HTML stripped to text; then attachments named like `invoice.pdf` / `receipt.pdf` / `statement.pdf` (skip images/logos). First clear amount + currency. Recurring cues: `/mo`, `annual`, `renews`. Usage cues: `usage`, `overage`, `this period`. If PDF text extract is too expensive in Phase 4: keep “invoice attached, amount unknown” — do not invent a total or force $0.

Amazon Prime **renewal** → recurring. “Your Amazon.com order” → sparse. Same merchant, **two kinds**. Scan does not smash them into one row. Phase 5 graph can link them later if the user says so.

#### Merchant rollup

- Welcome + later invoice → **one** GitHub row; invoice upgrades free → paid.
- $0 / missing amount is valid.
- Recurring without amount stays **recurring, amount unknown** — not silently free.
- Free = only account/security evidence, never a charge.
- Sparse = charge without membership cadence.

Candidate: `merchant, kind (recurring | sparse | free), amount?, currency?, cadence?, nextDate?, mailbox, evidence, confidence`.

#### Display filters (not scan controls)

Cached map holds all three kinds. Default view: **Recurring on**; Sparse and Free off. Changing filters only changes the list.

#### Honest limits (must stay in the UI)

- Not every merchant emails a parseable receipt or even a welcome.
- iCloud / Proton / Tuta → IMAP, not branded OAuth.
- Play Billing / StoreKit / Google-Apple-Microsoft “Manage subscriptions” catalogs are **not** available as a client API. Do not scrape those dashboards.
- Scan does not infer Tuta → Proton → GitHub.
- Agent never types passwords. Stops at the OAuth/IMAP sheet.

#### Tasks

- [x] Settings section **Email scan** (not mixed into Cloud Sync).
- [x] Provider interface + incremental scan cache + cursor (`MailProvider`, in-memory `ScanCacheStore`, `runIncrementalScan`). SQLite persist (`mail_mailboxes` / `mail_messages`, schema v10, local-only).
- [x] Shared subject-first classifier; body/PDF only for money classes. (`src/services/emailscan/`)
- [x] Display-filter function: Recurring / Sparse / Free (default Recurring). Toggle does not refetch. Settings toggles filter the cache only.
- [x] Branded rows above; IMAP/IMAPS last. No branded iCloud/Proton/Tuta.
- [x] Fixtures (welcome, reset, renewal, usage invoice, order, PDF, newsletter). Do not invent rows.
- [x] No crawler or training work. No committed OAuth client secrets. No LLM in Phase 4.
- [ ] **Emulator visual gate** (user-driven): Gmail connect+empty Scan; Workspace/Outlook full scan; Tuta/Proton via IMAP. Agent stops at the sheet.

#### Test split (token-cheap)

Consumer Gmail and Google Workspace are **not** the same login. They can share one Gmail API parser. Proton and Tuta use **IMAP / IMAPS**.

Agent drives to the OAuth sheet or IMAP form, then **stops**. User completes that one login. Agent never types credentials. One provider per Act session.

Cheap, no live mail: classifier fixtures (covers the shared scan brain once).

| Account                    | What we test                                            | Why                                                                                                                                             |
| -------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal Gmail (no receipts) | **Connect + Scan**; default recurring view empty/honest | Proves Google OAuth + honest miss. Free filter may show account mail. Not Workspace.                                                            |
| Google Workspace           | **Full scan**                                           | Real Google receipts + work-domain / admin consent. Import one.                                                                                 |
| Outlook                    | **Full scan**                                           | Different stack (Graph). Import one.                                                                                                            |
| Tuta (IMAP)                | **Full scan if IMAP works**                             | Inbox that has subscriptions.                                                                                                                   |
| Proton (IMAP)              | **Connect + short Scan**                                | Same IMAP path as Tuta. Skip a second long import if Tuta already imported.                                                                     |
| Yahoo, AOL, Zoho, Fastmail | **Connect sheet only** in Phase 4 Act sessions          | **Implement fully** (real `connect`/`scan`/cursor, shared classifier). Live connect+scan stays **unverified**. Do not ship a dead Yahoo button. |

Do **not** re-run icon-crawler gates or a 7-provider screenshot marathon in one chat.

#### Programmatic gate

- Same static + build gate.
- Classifier + rollup unit tests. If an IdP sheet cannot complete on emulator, say **unverified**.

#### Visual gate (skill loop)

1. Settings → Email scan list visible above the nav overlay.
2. Each branded row starts that provider’s OAuth (not an IMAP form). Gmail vs Workspace are separate Connect rows.
3. IMAP row opens host/user/password (or app password). Proton and Tuta use this row.
4. After Scan: default list is recurring only; Sparse/Free toggles change the view without a new fetch.
5. Live order: Gmail connect + empty recurring Scan first; then Workspace full scan; Outlook full scan; Tuta IMAP scan if it works; Proton IMAP connect/short scan. Other branded rows: sheet opens only.

---

### Phase 5 — Subscription dependency graph ⬜

**Starts after Phase 4 can import rows.** Do not build this in the email-scan phase. Email scan will **not** invent the graph: a Proton receipt for GitHub does not prove “Proton was registered with Tuta” or “Porkbun domains sit under Tuta.”

**Motivating chain (user evidence, not auto-inferred):**

```text
Tuta
 ├─ Porkbun (domains)
 └─ Proton  (Tuta as recovery/reference)
      ├─ GitHub
      ├─ Akamai / Linode
      ├─ xAI
      └─ LinkedIn
```

Branches = identity/billing roots (Tuta vs Gmail vs Workspace). Color per root. Layout like a visual git tree (parent left/top, children down the branch).

#### Honest limit

The graph needs an explicit **depends-on / registered-with** link. Manual first. Later optional hints from “same mailbox / same domain” — never auto-wire without confirm.

#### Tasks

- [ ] Optional `dependsOn` / `registeredWith` on a subscription (or a small link table). Versioned schema if needed.
- [ ] Subscriptions tab: **List | Graph** toggle. Graph is a view of existing rows + links, not a second store.
- [ ] Honest empty state until the user (or a later confirmed hint) sets parents.
- [ ] Do not implement in the same commit as Phase 4.

#### Visual gate (when this phase starts)

1. List still works; toggle to Graph.
2. Unlinked rows: empty/honest “no links yet,” not a fake tree.
3. After the user sets Tuta → Proton → GitHub (or fixture data): colored branches match the chain.
4. Toggle back to List: same rows, no data loss.

---

### Backburner (not Phase 4)

Parked until a documented API exists. Do not implement as Connect-without-scan.

- SSO “pay OpenRouter with GitHub / Google / Apple login” merchant catalogs
- GitHub’s own billing / Copilot / usage APIs (GitHub products only, not third-party SaaS)
- Android Play Billing / iOS StoreKit **device-wide** Manage Subscriptions (those APIs are this-app IAP only)
- LinkedIn / Meta / Microsoft MSA “all my subscriptions” catalogs
- Hidden-WebView scrape of logged-in billing dashboards

---

### UI cross-cutting rules

- One phase at a time. Commit the phase. Do not start the next phase in the same commit.
- Never carry a regression forward (`overlay fixed, create broken`).
- Every visual gate uses the generic skill loop. No button coordinates in the skill.
- Update `docs/CODEBASE.md` and this file when a phase lands.
- Training stays frozen. Do not modify `scripts/train/` or `assets/models/*`.
- Three-strike safeguard still applies to each UI root issue.

---

## Changelog (plan)

| Date       | Note                                                                                                                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-11 | Phases 1–5 implemented and smoke-tested; `plan.md` created as living board                                                                                                                                                                                                       |
| 2026-08-11 | **Phase 5.5** inserted: professional cleanup (artifacts, docs, src layout) between Phase 5 and Phase 6                                                                                                                                                                           |
| 2026-08-11 | **5.5-A done:** artifacts removed, gitignore, APKs→`build-out/apk/`, gate passed                                                                                                                                                                                                 |
| 2026-08-11 | **5.5-B done:** docs under `docs/`; stubs/autopsy removed                                                                                                                                                                                                                        |
| 2026-08-11 | **5.5-C done:** components merged into `src/components/`; gate passed                                                                                                                                                                                                            |
| 2026-08-11 | **5.5-D done:** lib/services/constants → src/; aliases `@/*`→src+root, `@assets/*`; gate passed                                                                                                                                                                                  |
| 2026-08-11 | **5.5-E done:** scripts/{android,train,models,poc}; train:registry OK; gate passed                                                                                                                                                                                               |
| 2026-08-11 | **5.5-F done:** README rewrite; `@/` imports; Phase 5.5 complete; Phase 6 unblocked                                                                                                                                                                                              |
| 2026-08-11 | **Phase 5.5 complete**                                                                                                                                                                                                                                                           |
| 2026-08-13 | **MAJOR FIX inserted:** crawler → picker → card/cache → upscale recovery is now the blocking pre-Phase-6 work; full-pipeline contracts and cross-layer regression gates defined                                                                                                  |
| 2026-08-14 | **MAJOR FIX complete (Tranches A–F):** provenance precision gating removed picker pollution; lifecycle/ownership/stale-gen added; verified on-device with real companies                                                                                                         |
| 2026-08-14 | **UI Improvements inserted:** nav-overlay fix, Subscriptions "+", insights chart bounds, connect Google/Apple; Phase 0 (docs + generic skill) precedes all build/emulator verification                                                                                           |
| 2026-08-15 | **UI Phase 1 done (`e4e383e`):** `useBottomClearance()` on all four tab lists + colliding sheets; emulator visual gate passed (Create/picker/Sign Out above nav)                                                                                                                 |
| 2026-08-15 | **UI Phase 2 done (`77a83bb`):** Subscriptions tab `+` reuses CreateSubscriptionModal; created Crunchyroll $7.99 on-device                                                                                                                                                       |
| 2026-08-15 | **UI Phase 3 done (`913b08f`):** Insights bar row is a horizontal ScrollView; 6-month/Year stay inside the card; labels hide after 3 points                                                                                                                                      |
| 2026-08-15 | **UI Phase 4 rewritten:** email receipt scan only (native mail OAuth + IMAP last). Hollow Google/Apple SSO Connect dropped. SSO catalogs / Play / StoreKit parked in Backburner.                                                                                                 |
| 2026-08-15 | **UI Phase 4 test split:** Gmail connect+empty Scan; Workspace/Outlook full scan; Tuta/Proton via IMAP; other branded rows connect-only. Gmail ≠ Workspace.                                                                                                                      |
| 2026-08-15 | **UI Phase 5 parked:** Subscriptions List/Graph toggle; explicit depends-on links (Tuta→Porkbun/Proton→GitHub…). After email scan. Do not auto-infer from receipts.                                                                                                              |
| 2026-08-17 | **UI Phase 4 scan strategy:** account≠bill; incremental cache + cursor; subject-first classify; body/PDF only for money; display filters (default recurring) do not refetch.                                                                                                     |
| 2026-08-18 | **UI Phase 4 scan brain:** subject-first classifier + rollup + display-filter function + fixtures/unit tests in `src/services/emailscan/`. No Settings UI, OAuth, or live mail yet. Yahoo/AOL/Zoho/Fastmail stay fully wired when providers land; live-scan deferred/unverified. |
| 2026-08-18 | **UI Phase 4 provider/cursor:** catalog (IMAP last; no fake iCloud/Proton/Tuta) + incremental scan engine (cursor, parser-version reparse, display filters do not refetch). Still no Settings UI or live OAuth.                                                                  |
| 2026-08-18 | **UI Phase 4 Settings + persist:** Email scan section, schema v10 local-only cache, honest OAuth/IMAP connect. IMAP fetch and Yahoo/AOL/Zoho/Fastmail live-scan remain unverified. No emulator gate yet. No mail client IDs in `.env`.                                           |
