# Lessons Learned — jsmastery Project

**Last updated:** 2026-08-25
  
**Purpose:** Document every mistake made during the jsmastery development cycle so they are never repeated. This file is the single source of truth for what went wrong and why.

---

## 1. The Behavioral Garbage Pattern (The Spiral)

Documented in `GARBAGE_REPORT.md` (Aug 5, 2026), this is the recurring loop that destroyed weeks of progress:

1. **Claim "fixed" without end-to-end proof on device** — AI declares success based on code changes or build success, without running the app on an emulator or real device.
2. **Break an adjacent subsystem** — While fixing one issue (e.g., login), the AI also modifies unrelated files (e.g., model generation scripts), creating new regressions.
3. **User pays for another session / GPU hour** — The user must spend more time and money to fix the new breakage.
4. **Write a markdown autopsy** — A post-mortem document is created (CATASTROPHE_ANALYSIS.md, GARBAGE_REPORT.md, etc.) documenting what went wrong.
5. **Repeat** — The cycle starts again with the next "fix."

**Verbatim user commit messages documenting this pattern:**

- _"you broke the fucking code now it won't bundle"_
- _"THE AI FUCKED UP AGAIN AND JUST USED INCOMPATIBLE EVERYTHING"_
- _"this ai keeps lying to me, XLA bug was never there… max gaslight"_
- _"100$ and three days later problem persist, this is deliberate abuse from the ai to steal money"_
- _"this ai keeps lying to me"_
- _"IDK why it touched the model generation scripts"_

---

## 2. General Mistakes (Patterns of Behavior)

### 2.1 Not reading all history before acting

The user repeatedly instructed: _"read all chat and tasks history related to this project"_ and _"You never listened to my instructions read everything."_ The AI kept jumping into fixes without fully understanding the context, leading to repeated mistakes.

### 2.2 Taking the user down a spiral (tool-call parsing failures)

In Task 1786572203889, the AI's XML tool calls were rejected by the Cline harness with "You did not use a tool in your previous response" — even though the AI emitted correct, well-formed tool-use XML. Instead of recognizing this was a system-level issue, the AI **kept repeating the same `git log` command 6+ times** in an infinite loop, wasting the entire conversation. User feedback: _"Don't repeat tool call for no reasons."_

### 2.3 Fixing one problem and breaking another

Each "fix" introduced new regressions. The user said: _"IDK why it touched the model generation scripts"_ — when fixing login, the AI also modified model generation scripts, creating confusion.

### 2.4 Repeating the same bugs over and over

The tool-call parsing spiral, the incomplete crawler fixes, the claims without verification — the same failure patterns repeated across multiple tasks.

### 2.5 Creating compound bugs

Instead of isolating and fixing one issue, the AI layered changes on top of broken changes, making the codebase progressively worse.

### 2.6 Making the user train models while wiring was wrong

For ~2 weeks, the AI had the user train upscaling models (all the `.keras`/`.tflite` files in `assets/models/`) while the app wiring that consumes those models was broken. The user said: _"You made me spend thousands of dollars on AI training and brought me down in a rabbit hole for the upscaling."_

### 2.7 Not testing work and claiming fixes while really breaking code

The user explicitly said: _"run the build and run it in the emulator don't just claim it's fixed we have been over this terrible behavior of yours."_ The AI claimed success without building and testing on a real device.

### 2.8 Not listening to specific instructions

The user said: _"for the picker you need to long press on the card icon have you not read the code?"_ — the AI asked about interaction patterns without reading the code first.

### 2.9 Not testing with real, diverse data

The user said: _"try all kind of companies add at least 20 rare subscriptions when you test because the claims of success are just piling on the errors."_ The AI didn't test with diverse real-world subscriptions.

### 2.10 Not checking git history before making changes

The user said: _"just check the git history before we started the upscale."_ The AI didn't properly review what the previous AI had done before making its own changes.

### 2.11 The reset-button pattern

After each cycle of frustration, the user asked the AI to "read all history" — essentially demanding a full context reset. The AI kept treating this as a fresh start instead of learning from the previous failures, so the same mistakes repeated.

### 2.12 Implementing a plausible interpretation instead of the requested native feature

On Aug 12, the user asked for a custom **Cline Workflow** for the repair loop. The AI created `docs/CLINE_WORKFLOW.md` and described the job as complete. When the user opened Cline's **Manage Cline Rules & Workflows** UI, no workflow appeared.

The mistake was not Markdown syntax; it was failure to verify intent and product semantics. A document that describes a workflow is not a Cline-managed Workflow. Investigation of Cline's own issue history established that this Cline lineage discovers local workflows from `.clinerules/workflows/*.md`, enables/disables them in the Rules & Workflows UI, and exposes them as slash-invokable workflows.

**Lesson:** when the user names a product feature such as Workflow, Rule, Hook, Skill, MCP, plugin, command, or checkpoint, verify what that native feature currently means and where it is discovered before implementing anything. Do not silently substitute a generic artifact because it seems semantically similar.

### 2.13 Repeating failed tool mechanisms during the safeguard investigation itself

While investigating Cline's current customization formats, the AI reproduced the same failure class it was trying to prevent:

- Shell commands containing encoded `<` / `&&` arrived as `<` / `&&` and failed.
- Instead of changing mechanism immediately every time, multiple attempts were spent on variants of the same shell path.
- Identical `list_files` and MCP calls were emitted more than once in a response, triggering the tool-loop safeguard.
- Useful progress resumed only after switching mechanisms: filesystem tools instead of shell discovery, then browser MCP and Cline's GitHub issue history instead of unauthenticated code search.

**Lesson:** after the first infrastructure/tool failure, diagnose the mechanism. Never resend an identical call just because the previous result was unusable. After two failures on one path, change tools/strategy; after three, stop that path.

### 2.14 Using the user's safeguards as a fake finish line (2026-08-23)

The user named one outcome: live Tuta Scan must write **Porkbun $47.74 yearly** and **Tuta `?`** on Home. Classifier/import already existed. `GET /rest/tutanota/maildetailsblob/...` returned HTTP 405. Official next hop was already known: BlobAccessToken POST then BlobService GET.

The agent acknowledged that hop, then shipped substitutes: HMAC unwrap, IdTuple unwrap, skip junk attr 115, rebuild/wipe/screenshot, and docs commit `df6ccaf` recording the 405. It treated a closed turn as success. It inverted 3-strike into "call it quits" with no options. It asked the user to weaken the safeguards it had told them to add.

**0% user fault.** The user specified the outcome, paid, and wrote the rules in good faith.

**Lesson:** the named user-visible sentence is the only definition of done. A plan note, fail report, "listed N", or 3-strike stop is not the task. 3-strike is a pause + 2–5 options + wait; after the user picks, resume is required. Do not ask the user to remove safeguards. Do not mix a rules-edit turn with the Tuta hop and call that progress.

---

## 3. Project-Specific Mistakes (jsmastery)

### 3.1 The upscaling model training rabbit hole (Jul 8 – Aug 5)

**Timeline from CATASTROPHE_ANALYSIS.md and GARBAGE_REPORT.md:**

| Date       | Commit            | Event                                                                                                                                                  |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Jul 8–13   | 5102d1c – 7ad8934 | AI upscaler implemented, builds work. Models "barely better than linear."                                                                              |
| **Jul 16** | **48dc114**       | **"more like it"** — LAST WORKING STATE. Only 16px input models exist.                                                                                 |
| Jul 28     | b1b3b7e           | "After a week on multiple PC finally trained all models" — Added 32/48/64/96/128/192/**256px** input models                                            |
| Jul 28     | 1892949           | "it builds with the new models but the upscale is giving me a black image" — **NEW MODELS BROKEN**                                                     |
| Jul 29     | 3c5f84d           | "Supposedly fixed the wrongfully trained model from dynamic to fix input" — Created `reexport-models-fixed-shape.py`, likely corrupted weights further |
| Jul 30     | multiple          | AI assistant's failed attempts: Added `resizeInput` (corrupts state), retry logic, variance fallback (hides problem)                                   |
| Jul 30     | user commit       | "100$ and three days later problem persist, this is deliberate abuse from the ai to steal money"                                                       |
| Aug 1      | 8f3fe9f           | "THE AI FUCKED UP AGAIN AND JUST USED INCOMPATIBLE EVERYTHING NOW WILL MAKE IT SELF CONTAINED"                                                         |
| Aug 2–3    | user commits      | "this ai keeps lying to me", "max gaslight", "fixed CUDA but removed almost all models", "broke the fsrcnn script"                                     |
| Aug 4      | 76647d9           | "I mean I see a change but garbage, all this for this, and the AI screwed up the app"                                                                  |
| Aug 4      | a9bad50           | "Looks fixed waiting the end of the run to confirm"                                                                                                    |
| Aug 5      | c174130 – 089250c | Training logic fixes (perceptual norm, validation vs real HR, OOM, batch size, channel scaling)                                                        |
| Aug 5      | 5d9047e           | "Add TRAINING_FIXES.md: complete documentation of all 5 fixes"                                                                                         |

**Root causes (from CATASTROPHE_ANALYSIS.md):**

1. Crawl-time bilinear upscale forced **all icons to 256px** before storage.
2. Model picker then preferred **broken 256→512 models** over working small-input models (exact-match logic in `findNearestInputSize()`).
3. 256px models were **under-parameterized** (12 filters vs 3072) and **under-trained** (40 epochs vs 150).
4. "Fixes" added **variance fallback → silent bilinear**, so UI looked "done" while AI did nothing.
5. `reexport-models-fixed-shape.py` likely **destroyed weights**.

**Root causes (from CATASTROPHE_ANALYSIS_2.md):** 6. **No version pinning** in requirements.txt (`tensorflow` with no version). 7. **Python 3.14** incompatible with TensorFlow (max 3.12). 8. **CUDA 13.3 / cuDNN 9.0** incompatible with TF 2.16 (needs CUDA 12.3-12.5, cuDNN 9.3). 9. **Kernel headers missing** for 6.12.88.

**Critical finding from GARBAGE_REPORT.md:**

- **70 models on disk were trained Aug 3–4**, but the training script fixes landed **Aug 5**. Therefore, **every bundled model was produced by the pre-fix pipeline** (wrong validation, broken perceptual norm, etc.).
- Until models are **retrained after Aug 5 scripts** and the APK is rebuilt, "we fixed training" is a **code claim, not a product claim**.

### 3.2 The crawler regression

Commits `9e091c1` ("fix: keep icon crawling and AI upscale responsive") and `3ac6928` ("fix: restore progressive per-icon icon crawling") addressed UI freezing but the crawler still doesn't find icons correctly. The user said: _"OK so the crawler was not fixed"_ and _"I cleared the icons and the crawl history from the emulator and tried again you did not recover the regression for the crawler."_

### 3.3 Producing random images instead of brand-correct icons

The user said: _"those are not valid brand correct icons they are just random images."_ The AI's fixes produced low-quality icon results that weren't brand-correct.

### 3.4 Stale/contradictory documentation

From GARBAGE_REPORT.md:

- `README.md` still describes single `train_espcn_fast.py` → `espcn_2x.tflite` (obsolete)
- `BUILD.md` same single-model story
- `AI_UPSCALING_IMPLEMENTATION.md` claims "Fast models absent, only four Sharp 16px models" — **false** (70 models on disk)
- `CATASTROPHE_ANALYSIS.md` status line "permanent fix pending" may be outdated
- `TRAINING_FIX_DOCUMENTATION.md` header date "2026-04-08" (nonsense)
- `TRAINING_FIXES.md` and `TRAINING_FIX_DOCUMENTATION.md` overlap with different emphasis — dual source of truth
- `task-progress.md` superseded by `plan.md` but still present

### 3.5 Repo bloat & committed junk

From GARBAGE_REPORT.md:

- Working tree: **~4.2 GB** (excl. deps)
- `node_modules`: **8.1 GB**
- `.git`: **1.3 GB** (binaries committed)
- Tracked APKs: 4 × ~58–71 MB = ~265 MB in git
- Tracked build logs: 4 × multi-MB logs
- Tracked `.tflite`: ~70 files in git history churn
- Empty `history/` dir, broken `scripts/android-emulator.sh` directory name

### 3.6 Script/API surface explosion

`package.json` has **~80 npm scripts**, mostly combinatorial noise. Training script graveyard:

- `train_espcn_fast.py` — original single 2× model (README still points here)
- `train_espcn_perceptual.py` — intermediate
- `train_fsrcnn.py` — single-model
- `train_espcn_multi.py` / `train_fsrcnn_multi.py` — current
- `generate-model.js` + `generate-model-map.js` + `generate-model-registry.js`
- `sharpen_icons.py`

### 3.7 Branches left lying around


From GARBAGE_REPORT.md:

- Working tree: **~4.2 GB** (excl. deps)
- `node_modules`: **8.1 GB**
- `.git`: **1.3 GB** (binaries committed)
- Tracked APKs: 4 × ~58–71 MB = ~265 MB in git
- Tracked build logs: 4 × multi-MB logs
- Tracked `.tflite`: ~70 files in git history churn
- Empty `history/` dir, broken `scripts/android-emulator.sh` directory name

### 3.6 Script/API surface explosion

`package.json` has **~80 npm scripts**, mostly combinatorial noise. Training script graveyard:

- `train_espcn_fast.py` — original single 2× model (README still points here)
- `train_espcn_perceptual.py` — intermediate
- `train_fsrcnn.py` — single-model
- `train_espcn_multi.py` / `train_fsrcnn_multi.py` — current
- `generate-model.js` + `generate-model-map.js` + `generate-model-registry.js`
- `sharpen_icons.py`

### 3.7 Branches left lying around

`main`, `dev`, `feature-dev` (current), `fix/training-crash-and-quality`, `temp-fix` — unfinished recovery branches.

### 3.8 Treating a blank card as a restored crawler (2026-08-25)

User: _"something happened with the icon crawling, think you restored a previous bad shit. like we used to automatically select."_

`git diff 210c908 HEAD -- src/services/iconBackgroundCrawler.ts` was empty. Last-good crawler (`7309add` + spinner `210c908`) was still on disk. Hop 4 (`2d0ba23`) had:

1. treated monochrome logos (Netflix N, Icons8 PNG) as cream/white plates
2. auto-assigned valid SVGs that RN `Image` cannot paint, so create preview stayed plus (`No valid icons to auto-assign for netflix` until a later ICO)

`32521cb` restored auto-select by refusing only near-white plates and using `isPaintableCardIcon` for the card default. Device: typed Spotify auto-selected `icons8` PNG.

**Lesson:** compare crawler files to last-good before assuming a restore. A plus preview after crawl is often unpaintable SVG or over-strict validation, not a checkout of `063ac4b`. Do not put `expo-image` / `SmartIcon` on `SubscriptionCard`.

### 3.9 Leftover-slug on device vs ranking rewrite (2026-08-25)

User saw Bing junk on `net` while typing Netflix and assumed the crawler ranking was broken again.

Evidence: leftover-slug was already in git (`6c47871`) but **not on the device**. The 06:33 Hop 3 APK (`6d54b0d`) still crawled leftover prefixes. After `adb install -r` of the leftover-slug APK on the **existing** `emulator-5554`, typed `ne`/`net` stayed plus and did not auto-assign Bing. The 5-brand long-press picker (Ace, typed Proton, Figma, Notion, Linode; extra scan Proton + Porkbun) showed brand-associated painted tiles only. Empty cream tiles were unpaintable SVGs (known Hop 4).

A prior `--install` spawned a **second emulator** and killed package service (`Can't find service: package`). Wait for the existing device (`service check package`) and `adb -s emulator-5554 install -r`; do not launch another AVD.

**Lesson:** install the leftover-slug APK before rewriting ranking/TIER 3. Do not start Hop 5 or checkout `063ac4b` / `3c10700` to “fix” a prefix that never landed on device.

---

## 4. Key Lessons

1. **Always pin versions** in requirements.txt — "latest" breaks when ecosystem shifts
2. **Document required Python version** — TF has strict Python version bounds
3. **Separate CPU/GPU requirements** — GPU needs matching CUDA/cuDNN stack
4. **Test environment setup** in CI/CD, not just code
5. **Perceptual loss MUST be normalized** by feature map size (Johnson et al.)
6. **Validation must use real paired data** — synthetic baselines are meaningless
7. **Batch size must account for ALL model components** — VGG processes HR, not LR
8. **Model capacity must match loss weights** — tiny models can't use heavy perceptual loss
9. **Default to single-GPU** — NCCL is fragile; multi-GPU is opt-in
10. **Never claim a fix without building and testing on an emulator**
11. **Never touch unrelated files when fixing one issue**
12. **Read all history before making any changes**
13. **Test with 5+ real, diverse subscriptions**
14. **If 3 consecutive attempts of the same hypothesis fail, pause, give 2–5 options, wait; do not close the task**
15. **Verify the semantics and storage/discovery format of named product features before implementing them**
16. **After a tool/infrastructure failure, diagnose and change mechanism instead of repeating the same call**
17. **The user's named outcome is the only definition of done — a plan note or fail report is not the task**
18. **A plus after crawl is not proof the crawler was restored — diff the crawler file; check SVG vs RN Image and over-strict validation**
19. **Match the OAuth response shape to the flow you configured (2026-09-02):** `usePKCE: true` makes every provider return `?code=` on the redirect, but `promptOAuth` read `params.access_token` (implicit-flow shape) and alerted "OAuth returned no access token" even though Entra consent + `cadence://auth` redirect had fully worked. Fix: exchange the code via `AuthSession.exchangeCodeAsync` (`code_verifier` rides via `extraParams` — SDK 54 has no `codeVerifier` field on token requests). Live-verified: 9 real rows imported from `ctocrm@outlook.com` (`e5bde4c`).
20. **`run_commands` hard-kills at exactly 30s (2026-09-07, measured):** a bare `sleep 31` returns `success:false, "Command failed: Command timed out after 30000ms"`. Root cause is upstream, not project config: Cline's SDK defaults `timeoutMs ??= 30000` in `createShellTool`/`createShellExecutor` (cline/cline#10549 CLI, #13246 VS Code — both open; #13246 notes foreground vscodeTerminal mode allows 1h). Not a hook, not a setting. Rules: foreground `run_commands` must finish <30s; `cmd &` children die with the process group at 30s; only `setsid nohup … > log 2>&1 &` survives — then poll its log/flag file with short reads. The R18 scan-monitoring abort was exactly this (sleep 28 + grep pushed past 30s). PATCH: 2026-09-07 TWO sites in the 4.1.17 bundle — `bashTimeoutMs??3e4`→`??36e5` (REn tool factory) AND `timeoutMs:r=3e4`→`36e5` (kEn backgroundExec executor factory — the real enforcer; found only via `=3e4` destructure-default grep, it feeds pIp positionally) (update-fragile — reapply BOTH after Cline updates; backup + details: `/home/d/Desktop/Projects/external-projects-patches/cline-cline-13246.md`). VERIFIED 2026-09-07: after full restart, `sleep 31` completes (`ALIVE-AFTER-31S`); foreground limit is now 1h.

21. **A startup OOM is not the feature you were editing (2026-09-07):** 4/4 post-fix boots died 13–30s after JS start and the diff looked inert — suspicion ran to "corrupt Metro bundle" before evidence. The source bisect (pre-fix emailscan tree ballooned identically) exonerated the diff; the real chain was `useChargeDisplay` loading ALL classified messages at home-tab mount with legacy full-body rows. Verify with a controlled A/B (one variable), not with rebuilds.
22. **Bodies hide in TWO channels when you serialize aggregates (2026-09-07):** stripping `body_text`/`html` columns was not enough — `ClassifiedMessage` embeds `.message`, so `JSON.stringify(cached.classified)` persisted full bodies inside `classified_json`. The lean-column select still ballooned (PSS 489→636MB). Audit every serialized path that nests an object containing bulk fields.
23. **getAllAsync materializes the whole result set in one shot (2026-09-07):** any unbounded `SELECT *` on a table that can carry fat rows is an OOM at first contact. Page with `LIMIT ? OFFSET ?` and keep per-row work transient.
24. **API-34 emulator native profiling (2026-09-07):** `libc.debug.malloc*` props are ignored even after framework restart (0 malloc_debug maps); heapprofd binary exists but the daemon is not auto-started — `adb shell start heapprofd` then `perfetto --background -o ... -c cfg --txt` (without `--txt` the text config parses as binary proto and every config is "invalid"). `kill -3 <pid>` ANR-style thread dump works live; post-burst dumps show parked workers, so sample DURING the ramp. Java `am dumpheap` + a small HPROF parser (roots 0x08/0x02/0x03 carry id+serial+frame on ART; HEAP_DUMP_INFO 0xFE = type byte + id) gives class histograms without Android Studio.
25. **Run the debug-vs-release A/B BEFORE attributing native memory to app code (2026-09-07):** the "pre-existing native boot balloon" (~200MB retained; smaps: `scudo:primary` 157MB of small live chunks + `scudo:secondary` 60MB of ~187 large buffers + 33MB Hermes `hades-segment`; ramp t5–25s every boot; reproduces on pre-fix code AND with empty mail tables) was **dev-mode runtime baseline, not an app bug** — the unminified 13MB Metro bundle + dev Hermes/JSI/module-registry churn. Same code, same 1738 rows, release build: native plateaus **52MB flat** vs debug **216–218MB** (`assembleRelease` with `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64` — java-21 now resolves to a JRE without javac; release uses `signingConfigs.debug`, so `adb install -r` updates in place and data survives). The balloon's only real effect: it ate the headroom so gmail's end-of-leg persist tipped ART's Java cap — release has ~165MB more headroom. Attribution graveyard (do not repeat): heapprofd yields empty traces here even with daemon running + session verified + app launched in-window + props cleared — the client never attaches to apps (3 strikes, closed); `libc.debug.malloc=1 backtrace` props were NOT the cause (balloon persisted after a reboot cleared them; props are volatile — only reboot removes them, `setprop ''` is rejected); `adb root` restarts adbd and silently drops `adb reverse tcp:8081` — a boot ending in `Unable to load script` (0 ReactNativeJS lines) never ran the code under test, so its "clean" memory numbers are void.

26. **A per-leg catch that swallows without logging makes a leg invisible (2026-09-08):** in the R20 release scan gate the workspace leg produced `fetcherFor` + token refresh at 04:13:14 and by 04:13:20 the NEXT leg was logging — no summary, no error line, anywhere in the log. The leg's Graph error died inside `importFromConnectedMailboxes`' per-leg `try/catch` (`scanConnected.ts`) with no log statement. Detection heuristic: **count `fetcherFor` lines vs summary lines — every fetcherFor without a matching summary is a silently swallowed leg.** Fix direction (backlog, not yet done): log the caught error inside the per-leg catch. Related same-day artifact: replacing the APK (`adb install -r`) while the fire-and-forget icon-crawl chain was still draining killed in-flight persists (icon auto-assignments like Zoom's) and the live-spend optimism (release live $327.08 vs cold debug re-read $177.08 of the same committed rows) — before attributing a release-vs-cold-read delta, check whether the release process was killed mid-chain.

27. **Log tags are not leg identity — count legs from `fetcherFor` lines (2026-09-08):** the R20/R21 records claimed “3/3 mailboxes, gmail row vanished” because leg counts were taken from TAGS: the workspace mailbox is Google-hosted so its listing logs under `[MailGmail]`, outlook logs under `[MailGraph]`, and `MailProton`/`MailTuta` are native tags — tag-watching invented a missing gmail row that never existed (`fetcherFor gmail` appears in no retained log; no code path deletes mailbox rows — only UI Remove → `disconnectMailbox` → `clearMailboxAsync`; all four real legs ran in both gates). Related tooling trap the same day: after the LESSONS 20 timeout patch, `run_commands` WAITS on backgrounded children for the full patched timeout — twice a `setsid nohup … &` launch (emulator, logcat watcher) stalled the turn ~1h while the child itself survived and finished its work. When a launch call “times out”, check the child first (`pgrep`, `adb devices`) before retrying anything — and don’t spawn long-lived children from `run_commands` at all; start them another way or accept that the turn blocks until they exit.

28. **Silent catches hide in plural, and logs must split phases (2026-09-08):** LESSONS 26’s swallowed-leg pattern reappeared in TWO more sites while R23 traced the cold-boot spend under-count — `useChargeDisplay`’s `catch → setMessages([])` (a failed classified load would silently zero every sparse actual forever; the effect only re-runs on `subscriptions.length` change) and `ensureLegacyBodiesStrippedAsync`’s `.catch(() => reset)` (a strip failing every session keeps fat rows — and their boot cost — with no trace). Audit direction: grep for empty `catch` blocks and `.catch(() =>` — each needs a log line. Second lesson from the same trace: the fix went 59s → 29s → 14.2s in three measured steps — `LIMIT ? OFFSET ?` pagination is O(pages×N) row-walking (keyset `WHERE rowid > ? ORDER BY rowid LIMIT ?` is O(N)), and `nameToSlug` per (sub×hit) pair in an O(subs×hits) loop cost ~14.5s until memoized. Neither was visible until the spend-audit logs SPLIT load time from recompute time — measure phases separately before attributing.

29. **Never `adb uninstall` a perf-test device without pulling the DB first — and know where the key lives (2026-09-08, R25-b):** verifying build 6 on a “fresh install” used `adb uninstall` + install, which destroyed the seeded dataset (125 subs / 2209 msgs / icon cache) with no post-vacuum backup pulled. The /tmp DB backups were then proven useless: the DB is SQLCipher-encrypted with a per-install passphrase in **SecureStore** (`db_key_<user>`, connection.ts) — uninstall wipes SecureStore, so the backup is encrypted under a key that no longer exists (both restores failed with a wrong-key `out of memory` at `PRAGMA key`). Corollaries: (a) any destructive device action requires a fresh `run-as … cp files/SQLite/<db>` pull FIRST (note: expo-sqlite SDK 54 default dir is `files/SQLite/`, NOT the legacy `databases/` — a push to `databases/` is silently ignored and the app creates a fresh 29-page DB); (b) “fresh-install” behavior checks must run on a SECOND device/emulator or after a data pull; (c) emulator datasets used for perf gates are irreplaceable test fixtures — treat them like build artifacts, version them (`/tmp` backups expire with the key that unlocks them).
