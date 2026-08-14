# Product plan — icons, crawl, DB, sync (no training)

**Last updated:** 2026-08-13

**Status:** Phases **1–5.5 complete**. **MAJOR FIX — icon crawler → picker → upscale recovery is OPEN and blocks Phase 6. Training frozen.**

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

| Phase   | Name                                                   | Status                   | Gate                                |
| ------- | ------------------------------------------------------ | ------------------------ | ----------------------------------- |
| **1**   | Registry → map + picker/persist                        | **Done**                 | `tsc`, x86_64 build, emu launch     |
| **2**   | Visual without training (`iconQuality` + source order) | **Done**                 | same + scorer smoke                 |
| **3**   | Crawl reliability                                      | **Done**                 | same                                |
| **4**   | DB split / schema hygiene                              | **Done**                 | same                                |
| **5**   | Sync honesty                                           | **Done**                 | same                                |
| **5.5** | Professional cleanup (artifacts, docs, structure)      | **Done**                 | complete                            |
| **MF**  | Icon crawler → picker → upscale pipeline recovery      | **OPEN — blocking**      | full cross-layer gate every tranche |
| **6**   | Ship polish                                            | **Blocked by Major Fix** | full smoke + doc pass               |

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

## MAJOR FIX — Icon crawler → picker → upscale pipeline recovery 🚨

**Status:** **OPEN — BLOCKS PHASE 6.** This is a correctness/recovery project, not ordinary ship polish.

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

Four user-requested UI improvements, executed one phase at a time. **Phase 0
(docs + generic skill) MUST complete before any build/emulator verification**,
because every later visual gate uses the generic emulator skill loop.

### Phase 0 — Documentation & generic skill (no code, no build)

- [ ] Append this UI-Improvements section to `docs/plan.md` (done by this edit).
- [ ] Write `docs/CODEBASE.md`: full current-codebase overview (tabs, modals,
      components, services, context, theme, models, icon-pipeline contracts).
- [ ] Rewrite `.cline/skills/emulator-ui-driving/SKILL.md` to be **generic**:
      invariant = every UI-affecting adb command (`input tap/swipe/text/keyevent`,
      `am start/force-stop`) is immediately followed by `adb exec-out screencap`
      read back via vision and asserted before the next UI command. Keep generic
      techniques (uiautomator-for-bounds, 1080x2400 space, nav bar ~y>2320,
      keyboard/dropdown dismissal, long-press = `input swipe X Y X Y 800`).
      NO button-specific coordinates.

### Phase 1 — Native navigation overlay fix

- Inset-aware bottom padding (`useSafeAreaInsets().bottom` + tab-bar height) on
  all four tabs and inside `CreateSubscriptionModal` + `SubscriptionIconPickerModal`
  sheets so primary buttons sit above the nav overlay.
- Gates: tsc/jest/lint → build → emulator (skill loop): each tab + both modals,
  assert primary button fully visible above nav bar; scroll list bottoms.

### Phase 2 — Add-subscription "+" on Subscriptions page

- Header row (title + `icons.add` Pressable) opening the existing
  `CreateSubscriptionModal` (replicate index.tsx wiring).
- Gates: programmatic → build → emulator (skill loop): "+" present, modal opens,
  created sub appears in list.

### Phase 3 — Insights chart stays in bounds

- Wrap "Estimated Monthly Spend" bar row in a horizontal `ScrollView` inside the
  card; fixed min-width per bar; condense/hide per-bar value labels for >3-month
  periods so 6mo/1yr scroll within the card.
- Gates: programmatic → build → emulator (skill loop): cycle This Month→3→6→Year,
  assert no overflow of the card border.

### Phase 4 — Connect Google/Apple to scan subscriptions

- New "Connected Accounts" section in Settings using `expo-auth-session` (already
  a dep) for Google + Apple sign-in; tokens in `expo-secure-store`; a
  "Scan for subscriptions" import action (Gmail/wallet receipt scanner = later
  server phase; now an import stub + manual prefill).
- Honest limit: no public client API reads other apps' Wallet/App-Store subs.
- Gates: programmatic → build → emulator (skill loop): Connect opens OAuth sheet,
  connected state persists.

### UI cross-cutting rules

- One phase at a time; commit per phase; never carry a regression forward.
- Every visual gate uses the generic skill loop (UI adb → screenshot → vision assert).
- Update `docs/CODEBASE.md` + this file as phases land.

---

## Changelog (plan)

| Date       | Note                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-11 | Phases 1–5 implemented and smoke-tested; `plan.md` created as living board                                                                                                             |
| 2026-08-11 | **Phase 5.5** inserted: professional cleanup (artifacts, docs, src layout) between Phase 5 and Phase 6                                                                                 |
| 2026-08-11 | **5.5-A done:** artifacts removed, gitignore, APKs→`build-out/apk/`, gate passed                                                                                                       |
| 2026-08-11 | **5.5-B done:** docs under `docs/`; stubs/autopsy removed                                                                                                                              |
| 2026-08-11 | **5.5-C done:** components merged into `src/components/`; gate passed                                                                                                                  |
| 2026-08-11 | **5.5-D done:** lib/services/constants → src/; aliases `@/*`→src+root, `@assets/*`; gate passed                                                                                        |
| 2026-08-11 | **5.5-E done:** scripts/{android,train,models,poc}; train:registry OK; gate passed                                                                                                     |
| 2026-08-11 | **5.5-F done:** README rewrite; `@/` imports; Phase 5.5 complete; Phase 6 unblocked                                                                                                    |
| 2026-08-11 | **Phase 5.5 complete**                                                                                                                                                                 |
| 2026-08-13 | **MAJOR FIX inserted:** crawler → picker → card/cache → upscale recovery is now the blocking pre-Phase-6 work; full-pipeline contracts and cross-layer regression gates defined        |
| 2026-08-14 | **MAJOR FIX complete (Tranches A–F):** provenance precision gating removed picker pollution; lifecycle/ownership/stale-gen added; verified on-device with real companies               |
| 2026-08-14 | **UI Improvements inserted:** nav-overlay fix, Subscriptions "+", insights chart bounds, connect Google/Apple; Phase 0 (docs + generic skill) precedes all build/emulator verification |
