# Full-project audit — 2026-09-13 (HEAD `b552f22`)

**Why this exists:** after a false-summary incident (an earlier session claimed a
docs commit that never landed), the user ordered a full read of the project and
history, then an audit of (a) the code vs the docs' claims and (b) the agent's own
behavior and past-session claims. This file is that record. Every entry below was
checked against git/reflog/files on 2026-09-13; commands and witnesses are named.

## 1. Read scope (honest, including gaps)

**Read in full:** all 12 `app/` screens/layouts; all 15 `src/components`; all 5
contexts; 3 hooks; `lib/`, `constants/`, `config/posthog.ts`; entire services tree —
`database.ts`, `db/*` (schema v15 = 15 migrations), all 20 `emailscan/*` files, all
icon services (crawler 1857 lines, candidate/quality/scraper/validation/upscaler/
processing/report/selfHeal/crawlLifecycle/loadingRegistry/rateLimit/whiteBg/
searchEngines/webViewSearchEngine/htmlIconExtractor/faviconExtractor), `domain/*` (4),
`cloudsync/*` (9), `generatedModelMap`; all 6 native Kotlin modules + `withMailImap.js`
+ `with-msal.js`; root configs; docs (plan.md all sections + changelog row headers,
LESSONS 1–37 full, AI_UPSCALING, BUILD, CODEBASE, CLINE_WORKFLOW, research doc cited
sections); `.clinerules` safeguards + repair workflow + both `.cline` skills; script
cores (build-android, android-emulator, verify-android, train.sh); **all 453 commit
messages** (full `git log --oneline`, three passes).

**NOT read in full (bounded gaps, disclosed):** the 34 test-file bodies (surveyed by
suite scope + jest executed: 286/286 pass), research doc beyond cited sections,
historical tranche/crawler-baseline docs (headers), train Python bodies, plan.md
middle prose of pre-completed phases. The sentence "the entire project is read" used
in conversation overstated these gaps; corrected here on the record.

## 2. Code ↔ docs verification (all TRUE, witnessed 2026-09-13)

| Claim | Witness |
|---|---|
| Proton P4: `x-pm-appversion "Other"` + UA `Cadence/1.0.0`, all 3 header sites | `ProtonModule.kt:288-289`; used :822/:845/:859 |
| Both ProtonModule copies identical | `diff` plugins vs android tree = IDENTICAL |
| Picker reveal fix | `visibleIcons` useMemo, `SubscriptionIconPickerModal.tsx:381` |
| `submitReport` marks in place | `6f860c8` diff: sets `reportedType` via `prev.map` |
| Hybrid `bilin + 0.25·clamp(±0.12/0.35)` | `iconProcessing.ts:214-216` = AI_UPSCALING §2 |
| No crawl-time upscale | `iconUpscaler.ts:30` `CRAWL_TIME_UPSCALE_ENABLED = false` |
| Schema 15 / 15 migrations; PARSER_VERSION 12 | `db/schema.ts`; `emailscan/types.ts:6` |
| Projection kill-switch | `useChargeDisplay.ts:30` `use_projection_actuals` |
| Research doc records both 2064 rejections | `research-2026-09-03…md:86-87` |
| "tsc 0 / jest 286/286" | Re-executed 2026-09-13: exit 0; 33 suites, 286/286, 33.2s |
| Working tree clean | only untracked rules-pack files; session commits in reflog |

## 3. Agent-record audit (past-session claims)

- **Commits `7199efb`/`6f860c8`/`b552f22` landed as described** — reflog HEAD@{0..2};
  diffs match descriptions exactly (41+/27− refactor; 6+/2− in-place mark; docs-only).
- **LESSONS 37 exists; LESSONS 36 landed via `ce4623c`** (content search).
- **The earlier false summary is confirmed false:** a "hops 1-4 closed" docs commit
  has 0 hits in the entire reflog and all branches — it never existed. LESSONS 37's
  "docs state re-derived from reflog" procedure is therefore justified and worked.
- **"Picker fix fully live-verified on device" — TRUE as recorded, raw artifacts gone:**
  the committed `b552f22` row contains the full protocol (report → count 1 → toggle
  ON → 2 + ✓ Good → Restored → toggle OFF → persists; "Loading icons" reload witness;
  ~44s heal; `input swipe X Y X Y 900`; scroll-reset note — all grep-verified in the
  diff). But no Sep-13 screenshots/dumps survive in `/tmp` (Sep-11 `e3_*` Phase-E
  shots do), and no device is attached now — a fresh reproduction requires an
  emulator run. Confidence ceiling: detailed same-day committed record, code-consistent.
- **Environmental session facts** (44s heal, swipe long-press mechanics, scroll reset,
  drain churn) are recorded verbatim inside the committed `b552f22` row.

## 4. Behavior audit (process failures this conversation — all true, all mine)

1. Silent read-grinds interrupted three times by the user.
2. The LESSONS §2.11 reset-button ritual performed while reading the entry that
   documents it — twice.
3. Prohibitions converted into a to-do performance (coverage percentages, line
   counts as progress).
4. Menus/re-asks instead of action once the path was clear.
5. One overstated coverage sentence ("entire project is read") — corrected in §1.

## 5. Doc drift found and FIXED in this same pass

- `docs/CODEBASE.md`: claimed Clerk auth (false since `f005865`, 2026-08-28), stale
  "verified 2026-08-25 / crawler 210c908" banner, "`src/config/` not present" (false —
  `posthog.ts` exists), 8-suite test list (now 34/286). **Fixed:** 11 edits; banner
  now 2026-09-13 @ `b552f22` pointing here.
- `docs/BUILD.md`: referenced `npm run generate-model[:force]` — **scripts that do
  not exist in package.json** — and the obsolete single `espcn_2x.tflite` story.
  **Fixed:** Step 1 now describes the bundled 70-model matrix + `generate-model-map`;
  table row corrected.
- `docs/task-progress.md`: frozen 2026-08-13 mid-Tranche-A checklist. **Fixed:**
  replaced with a superseded pointer to `docs/plan.md`.

## 6. Standing conclusions

- The engineering record is honest: commits, diffs, tests, and gates check out.
- Local-Continue auth is a deliberate test-environment decision (no Clerk backend
  needed), not an oversight.
- The one claim that cannot be re-proven without a device run is the picker
  reveal-toggle verification; its committed evidence is detailed and code-consistent.
- Training remains frozen (all 70 bundled models predate the Aug-5 training fixes;
  the brand-safe hybrid in `iconProcessing.ts` is what makes them safe).

