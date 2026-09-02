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

