# Cline Workflow — jsmastery Project

**Last updated:** 2026-08-12  
**Purpose:** The standard phased workflow for all Cline tasks in this project. Follows the principles in `.clinerules` and `docs/LESSONS_LEARNED.md`.

---

## Main Loop

Each phase follows this loop until the phase is complete:

```
┌─────────────┐
│  1. Analyse │  ← Read ALL relevant code, git history, prior conversations
└──────┬──────┘
       │
┌──────▼──────┐
│  2. Edit    │  ← Make targeted changes ONLY for this issue
└──────┬──────┘
       │
┌──────▼──────┐
│  3. Lint/   │  ← Check lint + syntax (tsc, eslint)
│  Syntax     │
└──────┬──────┘
       │
┌──────▼──────┐
│  4. Commit  │  ← Git commit before proceeding
└──────┬──────┘
       │
┌──────▼──────┐
│  5. Build   │  ← Build the app
│  + Emulator │  ← Launch on emulator
└──────┬──────┘
       │
┌──────▼──────┐
│  6. Test    │  ← Test on device with 20+ real subscriptions
└──────┬──────┘
       │
┌──────▼──────┐
│  7. Doc/    │  ← Update docs, clean up, hygiene
│  Hygiene    │
└──────┬──────┘
       │
┌──────▼──────┐
│  8. Commit  │  ← Git commit the doc/hygiene changes
└──────┬──────┘
       │
       ▼
  Phase done? ── No ──→ back to step 1
       │
      Yes
       │
       ▼
  Next phase
```

### Step 1: Analyse

- Read ALL relevant source files, git history, and prior conversations.
- Use subagents for broad exploration.
- Identify the root cause, not just symptoms.
- Do NOT start editing until you fully understand the problem.

### Step 2: Edit

- Make targeted changes ONLY for this specific issue.
- Do NOT touch unrelated files.
- If you discover a new issue, note it but do not fix it in this pass.

### Step 3: Lint/Syntax

- Run `npx tsc --noEmit` — must pass with no errors.
- Run `npx eslint .` — must pass with no errors.
- Fix any issues before proceeding.

### Step 4: Commit

- `git add -A && git commit -m "descriptive message"`
- Commit before building so you can always revert.

### Step 5: Build + Emulator

- Build the app: `npm run build:android:x86_64` (or appropriate arch).
- Launch on emulator.
- Verify the app starts without crashes.

### Step 6: Test

- Test the actual user-facing behavior on the device.
- Test with 20+ real, diverse subscriptions (rare companies, not just Netflix/Spotify).
- Verify icon quality is brand-correct, not random images.
- **Do not claim success without this step.**

### Step 7: Doc/Hygiene

- Update `docs/plan.md` with what was done.
- Update any relevant documentation.
- Clean up temporary files.
- Delete stale docs, don't create new ones alongside them.

### Step 8: Commit

- `git add -A && git commit -m "docs: update plan after [phase]"`

---

## Phase Gates

After each risky tranche (especially file moves, alias changes, or structural changes), run the full gate:

```bash
npx tsc --noEmit
npm run build:android:x86_64   # install + launch on emu when self-contained
# logcat: Running "main", no RN fatal; crawler may start
```

**Never combine high-risk changes untested.** For example, do not combine alias changes with file moves in the same pass.

---

## 3-Strike Safeguard Loop

If 3 consecutive fix attempts fail (the fix doesn't work on the emulator), **STOP immediately**:

```
┌─────────────────────────────────┐
│ 3 consecutive fix attempts fail │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 1. Interrupt the main loop      │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 2. Provide detailed resume to   │
│    the user (what was tried,     │
│    what failed, why)             │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 3. Git commit current state     │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 4. Brainstorm with the user     │
│    back and forth until settled  │
│    on a new solution             │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 5. Update docs (plan.md) with   │
│    the new approach              │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 6. Git commit the updated plan  │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 7. Resume the main loop with    │
│    the updated plan for that    │
│    part of the issue            │
└─────────────────────────────────┘
```

**What counts as a "failed attempt":**

- The fix doesn't resolve the reported issue on the emulator.
- The fix introduces a new regression.
- The build fails after the fix.
- `tsc` or `eslint` fails after the fix.

**What does NOT count:**

- A fix that works but has a minor lint issue (fix the lint and retry).
- A fix that works but needs a doc update (update the doc and continue).

---

## Phase Board (from docs/plan.md)

| Phase   | Name                                                 | Status           | Gate                          |
| ------- | ---------------------------------------------------- | ---------------- | ----------------------------- |
| **1**   | Registry → map + picker/persist                      | Done             | tsc, x86_64 build, emu launch |
| **2**   | Visual without training (iconQuality + source order) | Done             | same + scorer smoke           |
| **3**   | Crawl reliability                                    | Done             | same                          |
| **4**   | DB split / schema hygiene                            | Done             | same                          |
| **5**   | Sync honesty                                         | Done             | same                          |
| **5.5** | Professional cleanup (artifacts, docs, structure)    | Done             | gate after each tranche       |
| **6**   | Ship polish                                          | Open (after 5.5) | full smoke + doc pass         |

**Frozen (do not reopen casually):**

| ------- | ------ | -------- | ------ |
| **1** | Registry → map + picker/persist | Done | tsc, x86_64 build, emu launch |
| **2** | Visual without training (iconQuality + source order) | Done | same + scorer smoke |
| **3** | Crawl reliability | Done | same |
| **4** | DB split / schema hygiene | Done | same |
| **5** | Sync honesty | Done | same |
| **5.5** | Professional cleanup (artifacts, docs, structure) | Done | gate after each tranche |
| **6** | Ship polish | Open (after 5.5) | full smoke + doc pass |

**Frozen (do not reopen casually):**

- Training — see `docs/AI_UPSCALING.md` §2. Entry remains `npm run train:models:force` only when explicitly unfrozen.
- Inference hybrid — `bilin + 0.25 · clamp(residual)` — brand-safe defaults in `iconProcessing.ts`
- TFLite export — Float32 only — never default quant

---

## Standard Gate (every phase / risky tranche)

```bash
npx tsc --noEmit
npm run build:android:x86_64   # install + launch on emu when self-contained
# logcat: Running "main", no RN fatal; crawler may start
```
